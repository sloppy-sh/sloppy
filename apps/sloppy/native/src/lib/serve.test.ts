import type { ServeCall } from '@sloppy/types';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

const { tauriServe } = await import('./serve.js');

/** The shell's commands and events: what each command answers, and a way to
 *  send an event as `serve.rs` would. */
function shell(answers: Record<string, unknown> = {}, refusing: Record<string, string> = {}) {
	const asked: { command: string; args?: Record<string, unknown> }[] = [];
	const heard = new Map<string, Set<(event: { payload: unknown }) => void>>();
	const call = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
		asked.push({ command, ...(args === undefined ? {} : { args }) });
		if (command in refusing) throw refusing[command];
		return answers[command] as T;
	};
	const hear = async <T>(event: string, on: (event: { payload: T }) => void) => {
		const held = heard.get(event) ?? new Set();
		heard.set(event, held);
		const one = on as (event: { payload: unknown }) => void;
		held.add(one);
		return () => {
			held.delete(one);
		};
	};
	const send = (event: string, payload: unknown) => {
		for (const on of heard.get(event) ?? []) on({ payload });
	};
	return { asked, call, hear, send, heard };
}

const SERVING = {
	id: 'desk',
	ticket: 'endpointdesk',
	reach: 'local',
	paired: [],
	connections: 0
};

describe('serving to a headset from this computer', () => {
	it('starts at a reach, says what is served, and stops through the shell', async () => {
		const desk = shell({ serve_start: SERVING, serve_status: SERVING });
		const serve = tauriServe(desk.call, desk.hear);

		expect(await serve.start('anywhere', 'https://relay.example')).toEqual(SERVING);
		expect(await serve.status()).toEqual(SERVING);
		await serve.stop();

		expect(desk.asked).toEqual([
			{ command: 'serve_start', args: { reach: 'anywhere', relay: 'https://relay.example' } },
			{ command: 'serve_status' },
			{ command: 'serve_stop' }
		]);
	});

	it('says nothing is served where the shell answers none', async () => {
		const desk = shell({ serve_status: null });
		expect(await tauriServe(desk.call, desk.hear).status()).toBeUndefined();
	});

	it('shows a code through the shell, and passes the words it refuses one in', async () => {
		const pairing = { ...SERVING, pairing: { code: '042917', until: 120_000 } };
		const desk = shell({ serve_pair: pairing });
		expect(await tauriServe(desk.call, desk.hear).pair()).toEqual(pairing);
		expect(desk.asked).toEqual([{ command: 'serve_pair' }]);

		const resting = shell({}, { serve_pair: 'Turn on Serve to a headset first, then pair one.' });
		await expect(tauriServe(resting.call, resting.hear).pair()).rejects.toThrow(
			'Turn on Serve to a headset first'
		);
	});

	it('forgets a headset by its id', async () => {
		const desk = shell();
		await tauriServe(desk.call, desk.hear).forget('quest');

		expect(desk.asked).toEqual([{ command: 'serve_forget', args: { id: 'quest' } }]);
	});

	it('hands every line a headset sends to whoever is listening, until they stop', async () => {
		const desk = shell();
		const serve = tauriServe(desk.call, desk.hear);
		const lines: ServeCall[] = [];

		const stop = serve.calls((call) => lines.push(call));
		await Promise.resolve();
		desk.send('serve:call', { connection: '1', line: '{"id":1}' });
		stop();
		await new Promise((done) => setTimeout(done, 0));
		desk.send('serve:call', { connection: '1', line: '{"id":2}' });

		expect(lines).toEqual([{ connection: '1', line: '{"id":1}' }]);
	});

	it('answers on the connection a line came on', async () => {
		const desk = shell();
		await tauriServe(desk.call, desk.hear).answer('3', '{"id":1,"result":{}}');

		expect(desk.asked).toEqual([
			{ command: 'serve_answer', args: { connection: '3', line: '{"id":1,"result":{}}' } }
		]);
	});

	it('sends a line answering nothing on a connection, the way an answer goes', async () => {
		const desk = shell();
		await tauriServe(desk.call, desk.hear).notify('3', '{"method":"view/show"}');

		expect(desk.asked).toEqual([
			{ command: 'serve_answer', args: { connection: '3', line: '{"method":"view/show"}' } }
		]);
	});

	it('says which connection has gone, until nobody listens', async () => {
		const desk = shell();
		const serve = tauriServe(desk.call, desk.hear);
		const gone: string[] = [];

		const stop = serve.closed((connection) => gone.push(connection));
		await Promise.resolve();
		desk.send('serve:closed', { connection: '4' });
		stop();
		await new Promise((done) => setTimeout(done, 0));
		desk.send('serve:closed', { connection: '5' });

		expect(gone).toEqual(['4']);
	});

	it('passes the words the shell refused in', async () => {
		const desk = shell(
			{},
			{ serve_start: 'Serving could not start here. Check this computer is on a network.' }
		);

		await expect(tauriServe(desk.call, desk.hear).start('local')).rejects.toThrow(
			'Serving could not start here. Check this computer is on a network.'
		);
	});
});
