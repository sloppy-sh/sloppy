// `speech/hear` — turning the reader's voice into words with the desk's speech
// agent: docs/ARCHITECTURE.md § "A headset beside the desk".

import { type ServeMethodTable, ServeRefused } from '@sloppy/local';
import {
	NO_SPEECH_SAID,
	SERVE_REFUSALS,
	SPEECH_HEAR,
	SPEECH_LONGEST_MS,
	SPEECH_RATE,
	SPEECH_TOO_LONG_SAID,
	SPEECH_UNREADABLE_SAID,
	type SpeechHeard
} from '@sloppy/types';
import { hear, speechChosen } from '../hearing.js';
import { runtime } from '../runtime.js';

export { SPEECH_SYSTEM_NOT_ALLOWED_SAID } from '../hearing.js';

const BYTES_A_SAMPLE = 2;

/** The most sound a recording heard carries, in bytes. */
const MOST_SOUND = (SPEECH_LONGEST_MS / 1_000) * SPEECH_RATE * BYTES_A_SAMPLE;

/** Room for a WAV's header and the chunks a recorder adds beside its sound. */
const MOST_BESIDE_SOUND = 4_096;

/** The longest `audio` read at all, in base64 characters. */
const MOST_SENT = Math.ceil((MOST_SOUND + MOST_BESIDE_SOUND) / 3) * 4;

/** How long the sound in a WAV lasts, in milliseconds, where it is one this
 *  desk hears: PCM at `SPEECH_RATE`, mono, 16-bit. Undefined is any other. */
export function wavLasts(wav: Uint8Array): number | undefined {
	if (wav.length < 12 || tag(wav, 0) !== 'RIFF' || tag(wav, 8) !== 'WAVE') return undefined;
	const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
	let formatRight = false;
	for (let at = 12; at + 8 <= wav.length; ) {
		const name = tag(wav, at);
		const size = view.getUint32(at + 4, true);
		const body = at + 8;
		if (name === 'fmt ') {
			if (size < 16 || body + 16 > wav.length) return undefined;
			formatRight =
				view.getUint16(body, true) === 1 &&
				view.getUint16(body + 2, true) === 1 &&
				view.getUint32(body + 4, true) === SPEECH_RATE &&
				view.getUint16(body + 14, true) === BYTES_A_SAMPLE * 8;
			if (!formatRight) return undefined;
		} else if (name === 'data') {
			if (!formatRight) return undefined;
			const sound = Math.min(size, wav.length - body);
			if (sound < BYTES_A_SAMPLE) return undefined;
			return (sound / BYTES_A_SAMPLE / SPEECH_RATE) * 1_000;
		}
		at = body + size + (size % 2);
	}
	return undefined;
}

function tag(bytes: Uint8Array, at: number): string {
	return String.fromCharCode(...bytes.subarray(at, at + 4));
}

function decoded(audio: string): Uint8Array | undefined {
	try {
		const binary = atob(audio);
		const bytes = new Uint8Array(binary.length);
		for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
		return bytes;
	} catch {
		return undefined;
	}
}

async function heard(params: Record<string, unknown>): Promise<SpeechHeard> {
	const asked = await speechChosen();
	if (asked === undefined || runtime.speech() === undefined) {
		throw new ServeRefused(SERVE_REFUSALS.NO_SPEECH, NO_SPEECH_SAID);
	}
	const audio = params.audio;
	if (typeof audio !== 'string') {
		throw new ServeRefused(SERVE_REFUSALS.SPEECH_UNREADABLE, SPEECH_UNREADABLE_SAID);
	}
	if (audio.length > MOST_SENT) {
		throw new ServeRefused(SERVE_REFUSALS.SPEECH_TOO_LONG, SPEECH_TOO_LONG_SAID);
	}
	const wav = decoded(audio);
	const lasts = wav === undefined ? undefined : wavLasts(wav);
	if (wav === undefined || lasts === undefined) {
		throw new ServeRefused(SERVE_REFUSALS.SPEECH_UNREADABLE, SPEECH_UNREADABLE_SAID);
	}
	if (lasts > SPEECH_LONGEST_MS) {
		throw new ServeRefused(SERVE_REFUSALS.SPEECH_TOO_LONG, SPEECH_TOO_LONG_SAID);
	}
	try {
		return { said: await hear(wav, asked) };
	} catch (thrown) {
		throw new ServeRefused(SERVE_REFUSALS.SPEECH_FAILED, (thrown as Error).message);
	}
}

export const speechMethods: ServeMethodTable = {
	[SPEECH_HEAR]: { queued: false, handle: heard }
};
