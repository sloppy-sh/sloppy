// `SpeechAccess`, `SpeechProgramAccess`, `SpeechSystemAccess` and
// `SpeechRecorderAccess` over `src-tauri/src/speech.rs` and the speech plugin. A key is opened here, for the
// one recording it is sent with, and never handed to the page.

import type {
	SpeechAccess,
	SpeechProgramAccess,
	SpeechRecorderAccess,
	SpeechSystemAccess,
	SpeechSystemAllowed
} from '@sloppy/app-core';
import type { DeviceAiKeys } from '@sloppy/local';
import {
	SPEECH_ENDPOINTS,
	type SpeechAsked,
	speechAgentName,
	speechAgentReach,
	type SpeechHeard,
	type SpeechReach
} from '@sloppy/types';
import { invoke } from '@tauri-apps/api/core';
import { decodeBase64, encodeBase64, type Invoke } from './files';

const HEAR = 'speech_hear';
const PRESENT = 'speech_program_present';
const PICK_MODEL = 'speech_pick_model';
const SYSTEM_PRESENT = 'speech_system_present';
const SYSTEM_ALLOWED = 'plugin:speech|authorization';
const SYSTEM_AUTHORIZE = 'plugin:speech|request_authorization';
const MICROPHONE = 'plugin:speech|microphone';
const ALLOW_MICROPHONE = 'plugin:speech|request_microphone';
const RECORD = 'plugin:speech|start_recording';
const RECORDED = 'plugin:speech|stop_recording';

const HEARD_NOTHING = 'The desk could not hear that just now. Try again.';
const UNRECORDED = 'The microphone could not be used just now. Try again.';

/** The shell's own sentence where it gave one, else `otherwise`. */
function said(otherwise: string): (thrown: unknown) => never {
	return (thrown) => {
		throw new Error(typeof thrown === 'string' && thrown !== '' ? thrown : otherwise);
	};
}

/** What `speech_hear` is asked with: what the agent is, never which one. */
interface Hearing {
	reach: SpeechReach;
	model: string;
	baseUrl?: string;
	key?: string;
	programModel?: string;
}

async function hearing(asked: SpeechAsked, keys: DeviceAiKeys | undefined): Promise<Hearing> {
	const reach = speechAgentReach(asked.agent);
	if (reach === 'system') return { reach, model: asked.model };
	if (reach === 'program') {
		return { reach, model: asked.model, programModel: asked.programModel };
	}
	const endpoint = SPEECH_ENDPOINTS[asked.agent];
	const key = asked.key ?? (await keys?.open(asked.agent));
	if (!endpoint || key === undefined) {
		throw new Error(
			`There is no key for ${speechAgentName(asked.agent)} kept on the desk. On the desk, Settings → AI.`
		);
	}
	return { reach, model: asked.model, baseUrl: endpoint.baseUrl, key };
}

export function tauriSpeech(keys: DeviceAiKeys | undefined, call: Invoke = invoke): SpeechAccess {
	return {
		async hear(asked, wav) {
			const asking = await hearing(asked, keys);
			return await call<SpeechHeard>(HEAR, { asked: asking, wav: encodeBase64(wav) }).catch(
				said(HEARD_NOTHING)
			);
		}
	};
}

export function tauriSpeechProgram(call: Invoke = invoke): SpeechProgramAccess {
	return {
		present: () => call<boolean>(PRESENT).catch(() => false),
		pickModel: async () => (await call<string | null>(PICK_MODEL)) ?? undefined
	};
}

export function tauriSpeechSystem(call: Invoke = invoke): SpeechSystemAccess {
	return {
		present: () => call<boolean>(SYSTEM_PRESENT).catch(() => false),
		allowed: () => call<SpeechSystemAllowed>(SYSTEM_ALLOWED),
		authorize: () => call<SpeechSystemAllowed>(SYSTEM_AUTHORIZE),
		microphone: () => call<SpeechSystemAllowed>(MICROPHONE),
		allowMicrophone: () => call<SpeechSystemAllowed>(ALLOW_MICROPHONE)
	};
}

export function tauriSpeechRecorder(call: Invoke = invoke): SpeechRecorderAccess {
	return {
		start: () => call<void>(RECORD).catch(said(UNRECORDED)),
		stop: async () =>
			decodeBase64((await call<{ wav: string }>(RECORDED).catch(said(UNRECORDED))).wav)
	};
}
