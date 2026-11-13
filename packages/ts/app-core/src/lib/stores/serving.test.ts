import { containerApi, MemoryFiles } from '@sloppy/local';
import type { ServeCall, ServeReach, Serving } from '@sloppy/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initRuntime, type OpenTabs, type ServeAccess, type TabsAccess } from '../runtime.js';
import { prefs } from './prefs.svelte.js';
import { registerServeMethods } from '../serving/methods.js';
import { SERVED_ELSEWHERE, serving } from './serving.svelte.js';

const GARDEN = '/Users/me/Garden';
const THESIS = '/Users/me/thesis';

const SERVING: Serving = {
	id: 'desk-id',
	ticket: 'desk-ticket',
	reach: 'local',
	paired: [{ id: 'quest', name: 'Quest', paired_at: 1 }],
	connections: 0
};

/** A desk serving headsets: the lines it is sent are handed in by the test,
 *  and what it answers each connection with is kept. */
function desk() {
	const hear: ((call: ServeCall) => void)[] = [];
	const gone: ((connection: string) => void)[] = [];
	const answered = new Map<string, Record<string, unknown>[]>();
	const reaches: ServeReach[] = [];
	const relays: (string | undefined)[] = [];
	let held: Serving | undefined;
	let stopped = 0;
	let made = 0;
	const access: ServeAccess = {
		pair: async () => {
			if (!held) throw new Error('Turn on Serve to a headset first, then pair one.');
			made++;
			held = { ...held, pairing: { code: String(made).padStart(6, '0'), until: 120_000 } };
			return held;
		},
		start: async (reach, relay) => {
			reaches.push(reach);
			relays.push(relay);
			held = { ...SERVING, reach, ...(relay === undefined ? {} : { relay }) };
			return held;
		},
		stop: async () => {
			stopped++;
			held = undefined;
		},
		status: async () => held && { ...held, connections: answered.size },
		forget: async (id) => {
			if (held) held = { ...held, paired: held.paired.filter((one) => one.id !== id) };
		},
		calls(on) {
			hear.push(on);
			return () => hear.splice(hear.indexOf(on), 1);
		},
		answer: async (connection, line) => {
			answered.set(connection, [...(answered.get(connection) ?? []), JSON.parse(line)]);
		},
		notify: async (connection, line) => {
			answered.set(connection, [...(answered.get(connection) ?? []), JSON.parse(line)]);
		},
		closed(on) {
			gone.push(on);
			return () => gone.splice(gone.indexOf(on), 1);
		}
	};
	return {
		access,
		answered,
		send: (connection: string, message: object) => {
			for (const on of hear)
				on({ connection, line: JSON.stringify({ jsonrpc: '2.0', ...message }) });
		},
		listening: () => hear.length,
		close: (connection: string) => {
			for (const on of gone) on(connection);
		},
		spend: () => {
			if (held) held = { ...held, pairing: undefined };
		},
		counts: () => ({ started: reaches.length, stopped }),
		reaches,
		relays
	};
}

function folders(open: string[]) {
	const told: ((tabs: OpenTabs) => void)[] = [];
	const held = { open: [...open], active: open[0] };
	const access: TabsAccess = {
		held: () => ({ open: [...held.open], active: held.active }),
		close: async () => {},
		changed(hear) {
			told.push(hear);
			return () => told.splice(told.indexOf(hear), 1);
		}
	};
	return {
		access,
		open(root: string) {
			held.open.push(root);
			for (const hear of told) hear({ open: [...held.open], active: held.active });
		}
	};
}

async function aProject(root: string): Promise<MemoryFiles> {
	const files = new MemoryFiles({ root, data: `${root}-data` });
	await files.write('package.json', new TextEncoder().encode('{"name":"it"}'));
	await containerApi(files).openProject(root);
	return files;
}

async function settled(): Promise<void> {
	for (let turn = 0; turn < 50; turn++) await new Promise((done) => setTimeout(done, 0));
}

afterEach(async () => {
	await serving.stop();
	localStorage.clear();
	prefs.init();
	initRuntime({
		apiHost: () => 'http://api.test',
		serve: undefined,
		tabs: undefined,
		vault: undefined,
		placeFiles: undefined
	});
});

describe('serving to a headset', () => {
	it('says where serving is done, on a platform that cannot', async () => {
		initRuntime({ apiHost: () => 'http://api.test', serve: undefined });

		expect(serving.possible).toBe(false);
		await expect(serving.start()).rejects.toThrow(SERVED_ELSEWHERE);
		expect(serving.serving).toBeUndefined();
	});

	it('serves every folder open here by its name, each connection answered on its own', async () => {
		const garden = await aProject(GARDEN);
		const listening = desk();
		const open = folders([GARDEN, THESIS]);
		initRuntime({
			apiHost: () => 'http://api.test',
			serve: listening.access,
			tabs: open.access,
			placeFiles: (root) => (root === GARDEN ? garden : undefined)
		});

		expect(await serving.start()).toEqual(SERVING);

		listening.send('a', { id: 1, method: 'projects/list' });
		listening.send('b', {
			id: 1,
			method: 'tools/call',
			params: { name: 'list_notes', arguments: {} }
		});
		listening.send('b', {
			id: 2,
			method: 'tools/call',
			params: { name: 'list_notes', arguments: {} },
			project: 'thesis'
		});
		await settled();

		expect(listening.answered.get('a')).toEqual([
			{
				jsonrpc: '2.0',
				id: 1,
				result: {
					projects: [
						{ id: 'Garden', name: 'Garden' },
						{ id: 'thesis', name: 'thesis' }
					]
				}
			}
		]);
		const byId = new Map((listening.answered.get('b') ?? []).map((one) => [one.id, one]));
		expect(byId.get(1)).toMatchObject({ result: { isError: false } });
		expect(byId.get(2)).toMatchObject({ result: { isError: true } });
	});

	it('answers a method registered beside the served notes on the connection that asked, and says when it has gone', async () => {
		const garden = await aProject(GARDEN);
		const listening = desk();
		const gone: string[] = [];
		const drop = registerServeMethods(
			{
				'echo/one': {
					queued: false,
					handle: async (params, project, connection) => {
						connection.notify('echo/heard', { said: params.said });
						return { project: project.id };
					}
				}
			},
			(connection) => gone.push(connection)
		);
		initRuntime({
			apiHost: () => 'http://api.test',
			serve: listening.access,
			tabs: folders([GARDEN]).access,
			placeFiles: () => garden
		});

		await serving.start();
		listening.send('c', { id: 1, method: 'echo/one', params: { said: 'hi' } });
		await settled();
		listening.close('c');
		drop();

		expect(listening.answered.get('c')).toEqual([
			{ jsonrpc: '2.0', method: 'echo/heard', params: { said: 'hi' } },
			{ jsonrpc: '2.0', id: 1, result: { project: 'Garden' } }
		]);
		expect(gone).toEqual(['c']);
	});

	it('tells a registered method every connection has gone when serving stops', async () => {
		const garden = await aProject(GARDEN);
		const listening = desk();
		const gone: string[] = [];
		const drop = registerServeMethods(
			{ 'echo/one': { queued: false, handle: async () => ({}) } },
			(connection) => gone.push(connection)
		);
		initRuntime({
			apiHost: () => 'http://api.test',
			serve: listening.access,
			tabs: folders([GARDEN]).access,
			placeFiles: () => garden
		});

		await serving.start();
		listening.send('a', { id: 1, method: 'echo/one', params: {} });
		listening.send('b', { id: 1, method: 'echo/one', params: {} });
		await settled();
		listening.close('a');
		await serving.stop();
		drop();

		expect(gone).toEqual(['a', 'b']);
	});

	it('tells a registered method every connection has gone when serving moves to a new reach', async () => {
		const garden = await aProject(GARDEN);
		const listening = desk();
		const gone: string[] = [];
		const drop = registerServeMethods(
			{ 'echo/one': { queued: false, handle: async () => ({}) } },
			(connection) => gone.push(connection)
		);
		initRuntime({
			apiHost: () => 'http://api.test',
			serve: listening.access,
			tabs: folders([GARDEN]).access,
			placeFiles: () => garden
		});

		await serving.start('local');
		listening.send('c', { id: 1, method: 'echo/one', params: {} });
		await settled();
		await serving.start('anywhere');
		listening.close('c');
		await serving.stop();
		drop();

		expect(gone).toEqual(['c']);
	});

	it('answers the look this desk is wearing, as it is when asked', async () => {
		const listening = desk();
		initRuntime({
			apiHost: () => 'http://api.test',
			serve: listening.access,
			tabs: folders([GARDEN]).access
		});
		await serving.start();
		prefs.set('look', 'graphite');
		prefs.set('style', 'hardline');
		prefs.set('density', 'compact');
		prefs.set('fonts', { ui: 'atkinson', heading: 'system', mono: 'firacode' });

		listening.send('a', { id: 1, method: 'look/read' });
		await settled();
		prefs.set('look', 'paper');
		listening.send('a', { id: 2, method: 'look/read' });
		await settled();

		const [first, second] = listening.answered.get('a') ?? [];
		expect(first).toEqual({
			jsonrpc: '2.0',
			id: 1,
			result: {
				name: 'Graphite',
				based_on: 'graphite',
				style: 'hardline',
				density: 'compact',
				effect: prefs.current.effects,
				fonts: { ui: 'atkinson', heading: 'system', mono: 'firacode' }
			}
		});
		expect(second).toMatchObject({ id: 2, result: { name: 'Paper', based_on: 'paper' } });
	});

	it('refuses every act that writes', async () => {
		const garden = await aProject(GARDEN);
		const listening = desk();
		initRuntime({
			apiHost: () => 'http://api.test',
			serve: listening.access,
			tabs: folders([GARDEN]).access,
			placeFiles: () => garden
		});
		await serving.start();

		listening.send('a', {
			id: 1,
			method: 'tools/call',
			params: { name: 'write_note', arguments: { about: 'package.json', sections: ['It.'] } }
		});
		await settled();

		expect(listening.answered.get('a')?.[0]).toMatchObject({ result: { isError: true } });
	});

	it('serves a folder opened while serving', async () => {
		const listening = desk();
		const open = folders([GARDEN]);
		initRuntime({ apiHost: () => 'http://api.test', serve: listening.access, tabs: open.access });
		await serving.start();

		open.open(THESIS);
		listening.send('a', { id: 1, method: 'projects/list' });
		await settled();

		expect(listening.answered.get('a')?.[0]).toMatchObject({
			result: { projects: [{ name: 'Garden' }, { name: 'thesis' }] }
		});
	});

	it('serves the one folder open on a shell that holds no tabs', async () => {
		const listening = desk();
		initRuntime({
			apiHost: () => 'http://api.test',
			serve: listening.access,
			vault: {
				folder: () => THESIS,
				graph: async () => undefined,
				asks: false,
				open: async () => THESIS
			}
		});
		await serving.start();

		listening.send('a', { id: 1, method: 'projects/list' });
		await settled();

		expect(listening.answered.get('a')?.[0]).toMatchObject({
			result: { projects: [{ id: 'thesis', name: 'thesis' }] }
		});
	});

	it('lets every headset go when stopped, and hears no more', async () => {
		const listening = desk();
		initRuntime({
			apiHost: () => 'http://api.test',
			serve: listening.access,
			tabs: folders([GARDEN]).access
		});
		await serving.start();
		await serving.start();
		expect(listening.counts().started).toBe(1);
		expect(listening.listening()).toBe(1);

		await serving.stop();

		expect(serving.serving).toBeUndefined();
		expect(listening.listening()).toBe(0);
		expect(listening.counts().stopped).toBe(1);
	});

	it('serves anew at another reach, and keeps serving at the same one', async () => {
		const listening = desk();
		initRuntime({
			apiHost: () => 'http://api.test',
			serve: listening.access,
			tabs: folders([GARDEN]).access
		});

		await serving.start('local');
		await serving.start('local');
		expect((await serving.start('anywhere')).reach).toBe('anywhere');

		expect(listening.reaches).toEqual(['local', 'anywhere']);
		expect(listening.listening()).toBe(1);
	});

	it('shows no code until asked, a fresh one each time, and none once the desk shows none', async () => {
		const listening = desk();
		initRuntime({
			apiHost: () => 'http://api.test',
			serve: listening.access,
			tabs: folders([GARDEN]).access
		});
		await expect(serving.pair()).rejects.toThrow('Turn on Serve to a headset first');

		vi.useFakeTimers({ toFake: ['setInterval'] });
		try {
			await serving.start();
			expect(serving.serving?.pairing).toBeUndefined();

			expect((await serving.pair()).pairing?.code).toBe('000001');
			expect(serving.serving?.pairing?.code).toBe('000001');
			await serving.pair();
			expect(serving.serving?.pairing?.code).toBe('000002');

			listening.spend();
			vi.advanceTimersByTime(1000);
			await settled();
			expect(serving.serving?.pairing).toBeUndefined();
		} finally {
			vi.useRealTimers();
		}
	});

	it('forgets a paired headset, and says so', async () => {
		const listening = desk();
		initRuntime({
			apiHost: () => 'http://api.test',
			serve: listening.access,
			tabs: folders([GARDEN]).access
		});
		await serving.start();
		expect(serving.serving?.paired.map((one) => one.id)).toEqual(['quest']);

		await serving.forget('quest');

		expect(serving.serving?.paired).toEqual([]);
	});

	it('serves as far as this device last chose, and keeps the choice on it', async () => {
		const listening = desk();
		initRuntime({
			apiHost: () => 'http://api.test',
			serve: listening.access,
			tabs: folders([GARDEN]).access
		});
		expect(serving.choice).toEqual({ reach: 'local' });

		await serving.choose('anywhere', '  https://relay.example.com/  ');
		expect(listening.counts().started).toBe(0);
		expect(JSON.parse(localStorage.getItem('sloppy_serve') ?? 'null')).toEqual({
			reach: 'anywhere',
			relay: 'https://relay.example.com/'
		});

		await serving.start();
		expect(listening.reaches).toEqual(['anywhere']);
		expect(listening.relays).toEqual(['https://relay.example.com/']);
	});

	it('serves anew at once where the choice changes while serving, naming a relay only for anywhere', async () => {
		const listening = desk();
		initRuntime({
			apiHost: () => 'http://api.test',
			serve: listening.access,
			tabs: folders([GARDEN]).access
		});
		await serving.choose('local', 'https://relay.example.com/');
		await serving.start();

		await serving.choose('anywhere', 'https://relay.example.com/');
		await serving.choose('anywhere', 'https://relay.example.com/');
		await serving.choose('anywhere');

		expect(listening.reaches).toEqual(['local', 'anywhere', 'anywhere']);
		expect(listening.relays).toEqual([undefined, 'https://relay.example.com/', undefined]);
		expect(serving.serving?.reach).toBe('anywhere');
	});

	it('serves nothing where serving anew at another reach fails, and starts again when chosen back', async () => {
		const listening = desk();
		const refused: ServeAccess = {
			...listening.access,
			start: async (reach, relay) => {
				if (reach === 'anywhere') throw new Error('Serving could not start here. Try again.');
				return listening.access.start(reach, relay);
			}
		};
		initRuntime({
			apiHost: () => 'http://api.test',
			serve: refused,
			tabs: folders([GARDEN]).access
		});
		await serving.start('local');

		await expect(serving.choose('anywhere')).rejects.toThrow('could not start');
		expect(serving.serving).toBeUndefined();
		expect(listening.listening()).toBe(0);

		await serving.start('local');
		expect(listening.reaches).toEqual(['local', 'local']);
		expect(serving.serving?.reach).toBe('local');
	});

	it('serves again at the kept reach when Sloppy opens with serving left on', async () => {
		const listening = desk();
		const open = folders([]);
		initRuntime({
			apiHost: () => 'http://api.test',
			serve: listening.access,
			tabs: open.access
		});
		await serving.choose('anywhere', 'https://relay.example.com/');
		await serving.start();
		expect(serving.choice.on).toBe(true);
		await serving.stop();
		localStorage.setItem(
			'sloppy_serve',
			'{"reach":"anywhere","relay":"https://relay.example.com/","on":true}'
		);

		await serving.resume();
		await serving.resume();

		expect(listening.reaches).toEqual(['anywhere', 'anywhere']);
		expect(listening.relays).toEqual(['https://relay.example.com/', 'https://relay.example.com/']);
		expect(serving.serving?.pairing).toBeUndefined();
		expect(JSON.parse(localStorage.getItem('sloppy_serve') ?? 'null')).not.toHaveProperty(
			'pairing'
		);

		open.open(GARDEN);
		listening.send('c1', { id: 1, method: 'projects/list' });
		await settled();
		expect(listening.answered.get('c1')?.[0]?.result).toEqual({
			projects: [{ id: 'Garden', name: 'Garden' }]
		});
	});

	it('does not serve when Sloppy opens with serving turned off', async () => {
		const listening = desk();
		initRuntime({
			apiHost: () => 'http://api.test',
			serve: listening.access,
			tabs: folders([GARDEN]).access
		});
		await serving.start();
		await serving.stop();
		expect(serving.choice).toEqual({ reach: 'local' });

		await serving.resume();

		expect(listening.counts().started).toBe(1);
		expect(serving.serving).toBeUndefined();
	});

	it('says so where serving left on cannot start again, and keeps it on for next time', async () => {
		localStorage.setItem('sloppy_serve', '{"reach":"local","on":true}');
		initRuntime({
			apiHost: () => 'http://api.test',
			serve: {
				...desk().access,
				start: async () => {
					throw new Error('Serving could not start here. Try again.');
				}
			},
			tabs: folders([GARDEN]).access
		});

		await serving.resume();

		expect(serving.serving).toBeUndefined();
		expect(serving.says).toBe('Serving could not start here. Try again.');
		expect(serving.choice.on).toBe(true);
	});

	it('serves nothing again on a platform that cannot serve', async () => {
		localStorage.setItem('sloppy_serve', '{"reach":"local","on":true}');
		initRuntime({ apiHost: () => 'http://api.test', serve: undefined });

		await serving.resume();

		expect(serving.serving).toBeUndefined();
		expect(serving.says).toBeUndefined();
	});

	it('reads this network where what was kept is not a choice', () => {
		localStorage.setItem('sloppy_serve', '{"reach":"everywhere"}');
		expect(serving.choice).toEqual({ reach: 'local' });
		localStorage.setItem('sloppy_serve', 'not json');
		expect(serving.choice).toEqual({ reach: 'local' });
	});
});
