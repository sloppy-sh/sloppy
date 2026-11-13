// Turning a recording into words with the speech agent this desk hears with,
// for a headset and for the chat's microphone alike — docs/ARCHITECTURE.md
// § "A headset beside the desk".

import { SPEECH_ENDPOINTS, type SpeechAsked, speechAgentReach } from '@sloppy/types';
import { runtime } from './runtime.js';
import { prefs } from './stores/prefs.svelte.js';

const HEARD_NOTHING = 'The desk could not hear that just now. Try again.';

/** Said where this computer's own speech recognition is not allowed to hear. */
export const SPEECH_SYSTEM_NOT_ALLOWED_SAID =
	'The desk is not allowed to use speech recognition. On the desk, System Settings → Privacy & Security → Speech Recognition.';

const SPEECH_SYSTEM_CANNOT_SAID =
	'The desk cannot hear with its own speech recognition right now. On the desk, Settings → AI.';

/** Why a recording was not heard, in words for the person. */
export class Unheard extends Error {}

/** Whether this computer's own recogniser can hear here. */
async function speechSystemPresent(): Promise<boolean> {
	return (
		(await runtime
			.speechSystem()
			?.present()
			.catch(() => false)) ?? false
	);
}

/** The speech agent this desk hears with, or undefined where none can: the one
 *  the person chose, or this computer's own where they chose none. */
export async function speechChosen(): Promise<SpeechAsked | undefined> {
	const chosen = prefs.current;
	if (!chosen.aiOffered || runtime.speech() === undefined) return undefined;
	const agent = chosen.speechAgent ?? 'system';
	switch (speechAgentReach(agent)) {
		case 'system':
			return (await speechSystemPresent()) ? { agent, model: '' } : undefined;
		case 'program': {
			const programModel = chosen.speechProgramModel;
			if (programModel === null || runtime.speechProgram() === undefined) return undefined;
			return { agent, model: chosen.speechModel[agent] ?? '', programModel };
		}
		case 'key': {
			const held =
				(await runtime
					.aiKeys()
					?.held()
					.catch(() => [])) ?? [];
			if (!held.some((one) => one.provider === agent)) return undefined;
			const model = chosen.speechModel[agent] ?? SPEECH_ENDPOINTS[agent]?.models[0];
			return model === undefined ? undefined : { agent, model };
		}
	}
}

/** Asks the person, the first time only, whether this computer may hear them,
 *  and refuses with where to allow it when it may not. */
async function allowSystem(): Promise<void> {
	const allowed =
		(await runtime
			.speechSystem()
			?.authorize()
			.catch(() => undefined)) ?? 'restricted';
	if (allowed === 'authorized') return;
	throw new Unheard(
		allowed === 'restricted' ? SPEECH_SYSTEM_CANNOT_SAID : SPEECH_SYSTEM_NOT_ALLOWED_SAID
	);
}

/** What `wav` says, heard by `asked`. REJECTS with an {@link Unheard}. */
export async function hear(wav: Uint8Array, asked: SpeechAsked): Promise<string> {
	const speech = runtime.speech();
	if (speech === undefined) throw new Unheard(HEARD_NOTHING);
	if (speechAgentReach(asked.agent) === 'system') await allowSystem();
	try {
		const { said } = await speech.hear(asked, wav);
		return said.trim();
	} catch (thrown) {
		const words = thrown instanceof Error ? thrown.message.trim() : '';
		throw new Unheard(words === '' ? HEARD_NOTHING : words);
	}
}
