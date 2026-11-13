import { DeviceAiKeys, MemoryFiles, type Sealer } from '@sloppy/local';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const { tauriSpeech, tauriSpeechProgram, tauriSpeechRecorder, tauriSpeechSystem } =
	await import('./speech.js');

const sealer: Sealer = {
	seal: async (_, plaintext) => ({ sealed: plaintext, backing: 'software' }),
	open: async (_, sealed) => ({ plaintext: sealed, backing: 'software' }),
	remove: async () => true
};

function shell(answer: unknown, refusing?: string) {
	const asked: { command: string; args?: Record<string, unknown> }[] = [];
	const call = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
		asked.push({ command, ...(args === undefined ? {} : { args }) });
		if (refusing !== undefined) throw refusing;
		return answer as T;
	};
	return { asked, call };
}

const WAV = new Uint8Array([82, 73, 70, 70]);

describe('hearing on this desk', () => {
	it('opens the key for the recording, and tells the shell the endpoint rather than the agent', async () => {
		const keys = new DeviceAiKeys(new MemoryFiles({ root: '/device' }), sealer);
		await keys.hold('groq', 'gsk-1');
		const { asked, call } = shell({ said: 'hello' });

		const heard = await tauriSpeech(keys, call).hear(
			{ agent: 'groq', model: 'whisper-large-v3' },
			WAV
		);

		expect(heard).toEqual({ said: 'hello' });
		expect(asked).toEqual([
			{
				command: 'speech_hear',
				args: {
					asked: {
						reach: 'key',
						model: 'whisper-large-v3',
						baseUrl: 'https://api.groq.com/openai/v1',
						key: 'gsk-1'
					},
					wav: 'UklGRg=='
				}
			}
		]);
	});

	it('asks a program with its model file and no key', async () => {
		const { asked, call } = shell({ said: 'hi' });

		await tauriSpeech(undefined, call).hear(
			{ agent: 'whisper_cpp', model: '', programModel: '/m/ggml.bin' },
			WAV
		);

		expect(asked[0].args?.asked).toEqual({
			reach: 'program',
			model: '',
			programModel: '/m/ggml.bin'
		});
	});

	it('says where to give a key when none is kept, and passes the shell’s own words on', async () => {
		const keys = new DeviceAiKeys(new MemoryFiles({ root: '/device' }), sealer);
		const { asked, call } = shell(undefined);
		await expect(
			tauriSpeech(keys, call).hear({ agent: 'openai', model: 'whisper-1' }, WAV)
		).rejects.toThrow('There is no key for OpenAI kept on the desk. On the desk, Settings → AI.');
		expect(asked).toEqual([]);

		await keys.hold('openai', 'sk-1');
		await expect(
			tauriSpeech(keys, shell(undefined, 'Incorrect API key provided.').call).hear(
				{ agent: 'openai', model: 'whisper-1' },
				WAV
			)
		).rejects.toThrow('Incorrect API key provided.');
	});

	it('answers whether the program is here and the model file picked', async () => {
		expect(await tauriSpeechProgram(shell(true).call).present()).toBe(true);
		expect(await tauriSpeechProgram(shell(undefined, 'no').call).present()).toBe(false);
		expect(await tauriSpeechProgram(shell('/m/ggml.bin').call).pickModel()).toBe('/m/ggml.bin');
		expect(await tauriSpeechProgram(shell(null).call).pickModel()).toBeUndefined();
	});

	it("hears with this computer's own recogniser with nothing but the recording", async () => {
		const { asked, call } = shell({ said: 'hello' });

		await tauriSpeech(undefined, call).hear({ agent: 'system', model: '' }, WAV);

		expect(asked).toEqual([
			{ command: 'speech_hear', args: { asked: { reach: 'system', model: '' }, wav: 'UklGRg==' } }
		]);
	});

	it('asks the shell whether this computer can hear, and the person whether it may', async () => {
		const present = shell(true);
		expect(await tauriSpeechSystem(present.call).present()).toBe(true);
		expect(await tauriSpeechSystem(shell(undefined, 'no').call).present()).toBe(false);

		const allowed = shell('denied');
		expect(await tauriSpeechSystem(allowed.call).allowed()).toBe('denied');
		const asking = shell('authorized');
		expect(await tauriSpeechSystem(asking.call).authorize()).toBe('authorized');

		expect([present, allowed, asking].map((one) => one.asked[0].command)).toEqual([
			'speech_system_present',
			'plugin:speech|authorization',
			'plugin:speech|request_authorization'
		]);
	});

	it('asks the shell about the microphone, and the person whether it may be used', async () => {
		const standing = shell('undecided');
		expect(await tauriSpeechSystem(standing.call).microphone()).toBe('undecided');
		const asking = shell('authorized');
		expect(await tauriSpeechSystem(asking.call).allowMicrophone()).toBe('authorized');

		expect([standing, asking].map((one) => one.asked[0].command)).toEqual([
			'plugin:speech|microphone',
			'plugin:speech|request_microphone'
		]);
	});
});

describe('recording on this desk', () => {
	it('starts, and answers the recording as bytes when it stops', async () => {
		const starting = shell(null);
		await tauriSpeechRecorder(starting.call).start();
		const stopping = shell({ wav: 'UklGRg==' });

		expect(await tauriSpeechRecorder(stopping.call).stop()).toEqual(WAV);
		expect([starting, stopping].map((one) => one.asked[0].command)).toEqual([
			'plugin:speech|start_recording',
			'plugin:speech|stop_recording'
		]);
	});

	it("passes the shell's own words on, and says to try again where it gave none", async () => {
		await expect(
			tauriSpeechRecorder(shell(undefined, 'Sloppy is already listening.').call).start()
		).rejects.toThrow('Sloppy is already listening.');
		await expect(tauriSpeechRecorder(shell(undefined, '').call).stop()).rejects.toThrow(
			'The microphone could not be used just now. Try again.'
		);
	});
});
