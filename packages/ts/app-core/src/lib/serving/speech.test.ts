import {
	type AiKeysAccess,
	containerApi,
	type KeyHeldFor,
	MemoryFiles,
	namedProjects,
	servingProjects
} from '@sloppy/local';
import {
	NO_SPEECH_SAID,
	SERVE_REFUSALS,
	SPEECH_HEAR,
	SPEECH_RATE,
	SPEECH_TOO_LONG_SAID,
	SPEECH_UNREADABLE_SAID,
	type SpeechAsked
} from '@sloppy/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	initRuntime,
	type SpeechAccess,
	type SpeechSystemAccess,
	type SpeechSystemAllowed
} from '../runtime.js';
import { prefs } from '../stores/prefs.svelte.js';
import { SPEECH_SYSTEM_NOT_ALLOWED_SAID, speechMethods, wavLasts } from './speech.js';

/** A WAV of `seconds` of silence. */
function wav(seconds: number, { rate = SPEECH_RATE, channels = 1, bits = 16 } = {}): Uint8Array {
	const sound = Math.round(seconds * rate) * channels * (bits / 8);
	const bytes = new Uint8Array(44 + sound);
	const view = new DataView(bytes.buffer);
	const write = (at: number, words: string) =>
		[...words].forEach((one, i) => view.setUint8(at + i, one.charCodeAt(0)));
	write(0, 'RIFF');
	view.setUint32(4, 36 + sound, true);
	write(8, 'WAVE');
	write(12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, channels, true);
	view.setUint32(24, rate, true);
	view.setUint32(28, rate * channels * (bits / 8), true);
	view.setUint16(32, channels * (bits / 8), true);
	view.setUint16(34, bits, true);
	write(36, 'data');
	view.setUint32(40, sound, true);
	return bytes;
}

function base64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

/** Hears every recording as the words it is told to, and keeps what it was asked. */
function hearing(said = 'take me to the second note') {
	const asked: { asked: SpeechAsked; bytes: number }[] = [];
	let fails: Error | undefined;
	const access: SpeechAccess = {
		hear: async (one, recording) => {
			asked.push({ asked: one, bytes: recording.length });
			if (fails) throw fails;
			return { said: ` ${said} ` };
		}
	};
	return { access, asked, failWith: (error: Error) => (fails = error) };
}

function keysFor(...held: KeyHeldFor['provider'][]): AiKeysAccess {
	return {
		held: async () => held.map((provider) => ({ provider, backing: 'hardware' as const })),
		hold: async () => 'hardware',
		forget: async () => {}
	};
}

async function ask(params: unknown): Promise<Record<string, unknown>> {
	const files = new MemoryFiles({ root: '/work/garden', data: '/work/garden-data' });
	await files.write('package.json', new TextEncoder().encode('{"name":"it"}'));
	await containerApi(files).openProject('/work/garden');
	const loop = servingProjects(
		namedProjects([{ name: 'garden', server: { version: '1', files } }]),
		{ methods: speechMethods }
	);
	const answers: Record<string, unknown>[] = [];
	loop.take(
		JSON.stringify({ jsonrpc: '2.0', id: 1, method: SPEECH_HEAR, params }),
		(line) => answers.push(JSON.parse(line)),
		'quest'
	);
	await loop.settled();
	expect(answers).toHaveLength(1);
	return answers[0];
}

function refused(code: number, message: string) {
	return { jsonrpc: '2.0', id: 1, error: { code, message } };
}

let ear: ReturnType<typeof hearing>;

beforeEach(() => {
	ear = hearing();
	prefs.set('aiOffered', true);
	prefs.set('speechAgent', 'groq');
	prefs.set('speechModel', {});
	prefs.set('speechProgramModel', null);
	initRuntime({ apiHost: () => '', speech: ear.access, aiKeys: keysFor('groq') });
});

afterEach(() => {
	localStorage.clear();
	prefs.init();
	initRuntime({
		apiHost: () => '',
		speech: undefined,
		speechProgram: undefined,
		speechSystem: undefined,
		aiKeys: undefined
	});
});

describe('hearing a reader from a headset', () => {
	it('answers the words the speech agent heard, asked with the first model it offers', async () => {
		const answer = await ask({ audio: base64(wav(2)) });

		expect(answer).toEqual({
			jsonrpc: '2.0',
			id: 1,
			result: { said: 'take me to the second note' }
		});
		expect(ear.asked).toEqual([
			{ asked: { agent: 'groq', model: 'whisper-large-v3-turbo' }, bytes: 44 + 2 * SPEECH_RATE * 2 }
		]);
	});

	it('asks a program agent with the model file the person picked', async () => {
		prefs.set('speechAgent', 'whisper_cpp');
		prefs.set('speechProgramModel', '/models/ggml-base.en.bin');
		initRuntime({
			apiHost: () => '',
			speech: ear.access,
			speechProgram: { present: async () => true, pickModel: async () => undefined }
		});

		await ask({ audio: base64(wav(1)) });

		expect(ear.asked[0].asked).toEqual({
			agent: 'whisper_cpp',
			model: '',
			programModel: '/models/ggml-base.en.bin'
		});
	});

	it('tells the headset where to set speech up when the desk has none', async () => {
		const audio = base64(wav(1));
		const noSpeech = refused(SERVE_REFUSALS.NO_SPEECH, NO_SPEECH_SAID);

		prefs.set('speechAgent', null);
		expect(await ask({ audio })).toEqual(noSpeech);

		prefs.set('speechAgent', 'openai');
		expect(await ask({ audio })).toEqual(noSpeech);

		prefs.set('speechAgent', 'whisper_cpp');
		expect(await ask({ audio })).toEqual(noSpeech);

		prefs.set('speechAgent', 'groq');
		prefs.set('aiOffered', false);
		expect(await ask({ audio })).toEqual(noSpeech);

		prefs.set('aiOffered', true);
		initRuntime({ apiHost: () => '', speech: undefined, aiKeys: keysFor('groq') });
		expect(await ask({ audio })).toEqual(noSpeech);

		expect(ear.asked).toEqual([]);
	});

	it('refuses a recording longer than a minute, whether its header says so or its size does', async () => {
		const tooLong = refused(SERVE_REFUSALS.SPEECH_TOO_LONG, SPEECH_TOO_LONG_SAID);

		expect(await ask({ audio: base64(wav(60.5)) })).toEqual(tooLong);
		expect(await ask({ audio: 'A'.repeat(4_000_000) })).toEqual(tooLong);
		expect((await ask({ audio: base64(wav(60)) })).result).toBeDefined();
		expect(ear.asked).toHaveLength(1);
	});

	it('refuses what is not a WAV it can hear', async () => {
		const unreadable = refused(SERVE_REFUSALS.SPEECH_UNREADABLE, SPEECH_UNREADABLE_SAID);

		expect(await ask({})).toEqual(unreadable);
		expect(await ask({ audio: 'not base64 at all!' })).toEqual(unreadable);
		expect(await ask({ audio: base64(new TextEncoder().encode('hello there')) })).toEqual(
			unreadable
		);
		expect(await ask({ audio: base64(wav(1, { rate: 44_100 })) })).toEqual(unreadable);
		expect(await ask({ audio: base64(wav(1, { channels: 2 })) })).toEqual(unreadable);
		expect(await ask({ audio: base64(wav(1, { bits: 8 })) })).toEqual(unreadable);
		expect(await ask({ audio: base64(wav(0)) })).toEqual(unreadable);
		expect(ear.asked).toEqual([]);
	});

	it("passes the agent's own sentence on when it could not hear", async () => {
		ear.failWith(new Error('Your key was not accepted. Check it on the desk.'));
		expect(await ask({ audio: base64(wav(1)) })).toEqual(
			refused(SERVE_REFUSALS.SPEECH_FAILED, 'Your key was not accepted. Check it on the desk.')
		);

		ear.failWith(new Error(''));
		expect(await ask({ audio: base64(wav(1)) })).toEqual(
			refused(SERVE_REFUSALS.SPEECH_FAILED, 'The desk could not hear that just now. Try again.')
		);
	});
});

/** This computer's recogniser, here or not, answering `allowed` when asked. */
function aComputer(
	here: boolean,
	allowed: SpeechSystemAllowed = 'authorized'
): SpeechSystemAccess & { asked: number } {
	const system = {
		asked: 0,
		present: async () => here,
		allowed: async () => allowed,
		authorize: async () => {
			system.asked += 1;
			return allowed;
		},
		microphone: async () => 'authorized' as const,
		allowMicrophone: async () => 'authorized' as const
	};
	return system;
}

describe("hearing with this computer's own recogniser", () => {
	beforeEach(() => {
		prefs.set('speechAgent', null);
	});

	it('hears with it where nothing is chosen, asking the person first', async () => {
		const system = aComputer(true);
		initRuntime({ apiHost: () => '', speech: ear.access, speechSystem: system });

		const answer = await ask({ audio: base64(wav(1)) });

		expect(answer.result).toEqual({ said: 'take me to the second note' });
		expect(ear.asked.map((one) => one.asked)).toEqual([{ agent: 'system', model: '' }]);
		expect(system.asked).toBe(1);
	});

	it('tells the headset the desk has no speech where the computer has no recogniser and nothing is chosen', async () => {
		initRuntime({ apiHost: () => '', speech: ear.access, speechSystem: aComputer(false) });

		expect(await ask({ audio: base64(wav(1)) })).toEqual(
			refused(SERVE_REFUSALS.NO_SPEECH, NO_SPEECH_SAID)
		);
		expect(ear.asked).toEqual([]);
	});

	it('hears with the agent the person chose rather than the computer', async () => {
		prefs.set('speechAgent', 'groq');
		const system = aComputer(true);
		initRuntime({
			apiHost: () => '',
			speech: ear.access,
			speechSystem: system,
			aiKeys: keysFor('groq')
		});

		await ask({ audio: base64(wav(1)) });

		expect(ear.asked.map((one) => one.asked.agent)).toEqual(['groq']);
		expect(system.asked).toBe(0);
	});

	it('says where to allow it when the person has not, and hears nothing', async () => {
		initRuntime({ apiHost: () => '', speech: ear.access, speechSystem: aComputer(true, 'denied') });

		expect(await ask({ audio: base64(wav(1)) })).toEqual(
			refused(SERVE_REFUSALS.SPEECH_FAILED, SPEECH_SYSTEM_NOT_ALLOWED_SAID)
		);
		expect(SPEECH_SYSTEM_NOT_ALLOWED_SAID).toBe(
			'The desk is not allowed to use speech recognition. On the desk, System Settings → Privacy & Security → Speech Recognition.'
		);
		expect(ear.asked).toEqual([]);
	});
});

describe('how long a WAV lasts', () => {
	it('reads past chunks a recorder adds before the sound', () => {
		const plain = wav(1.5);
		const listed = new Uint8Array(plain.length + 14);
		listed.set(plain.subarray(0, 36));
		listed.set(new TextEncoder().encode('LIST'), 36);
		new DataView(listed.buffer).setUint32(40, 5, true);
		listed.set(plain.subarray(36), 50);

		expect(wavLasts(plain)).toBe(1_500);
		expect(wavLasts(listed)).toBe(1_500);
	});
});
