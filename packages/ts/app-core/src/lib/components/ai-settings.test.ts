import type { AiKeysAccess, KeyHeldFor, KeyProvider } from '@sloppy/local';
import { CHAT_AGENTS, type ChatAgent } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	type ChatAccess,
	initRuntime,
	type SpeechAccess,
	type SpeechProgramAccess,
	type SpeechSystemAccess,
	type SpeechSystemAllowed
} from '../runtime.js';
import { seamSettledAgain } from '../seam.svelte.js';
import { chat } from '../stores/chat.svelte.js';
import { prefs } from '../stores/prefs.svelte.js';
import AiSettings from './ai-settings.svelte';

/** Keys as a device would hold them, and what it was asked. */
function keysHolding(): AiKeysAccess & { held_: KeyHeldFor[]; given: string[] } {
	const held_: KeyHeldFor[] = [];
	const given: string[] = [];
	return {
		held_,
		given,
		held: async () => [...held_],
		hold: async (provider: KeyProvider, secret: string) => {
			given.push(`${provider}=${secret}`);
			held_.push({ provider, backing: 'hardware' });
			return 'hardware';
		},
		forget: async (provider: KeyProvider) => {
			const at = held_.findIndex((one) => one.provider === provider);
			if (at !== -1) held_.splice(at, 1);
		}
	};
}

let keys: ReturnType<typeof keysHolding>;
let programs: ChatAgent[];
let looked: number;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

const access: ChatAccess = {
	agents: async () => {
		looked += 1;
		return [
			...programs,
			...(await keys.held()).flatMap(
				(one) => CHAT_AGENTS.find((agent) => agent === one.provider) ?? []
			)
		];
	},
	open: async () => ({
		say: async () => {},
		stop: async () => {},
		close: async () => {}
	})
};

async function settle(): Promise<void> {
	for (let turn = 0; turn < 6; turn += 1) {
		await new Promise((done) => setTimeout(done, 0));
		flushSync();
	}
}

const screen = () => (target.textContent ?? '').replace(/\s+/g, ' ');
const button = (words: string): HTMLButtonElement | undefined =>
	[...target.querySelectorAll('button')].find((one) => one.textContent?.trim() === words);
const toggle = () => target.querySelector<HTMLButtonElement>('[role="switch"]');
const switches = () => [...target.querySelectorAll<HTMLButtonElement>('[role="switch"]')];

function show(): void {
	mounted = mount(AiSettings, { target });
	flushSync();
}

beforeEach(() => {
	keys = keysHolding();
	programs = ['claude_code'];
	looked = 0;
	prefs.set('aiOffered', false);
	prefs.set('chatInBackground', false);
	chat.clear();
	initRuntime({ apiHost: () => 'http://api.test', chat: access, aiKeys: keys });
	seamSettledAgain();
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	prefs.set('aiOffered', false);
	prefs.set('chatInBackground', false);
	chat.clear();
	initRuntime({
		apiHost: () => '',
		chat: undefined,
		aiKeys: undefined,
		speech: undefined,
		speechProgram: undefined,
		speechSystem: undefined
	});
	localStorage.clear();
	prefs.init();
	seamSettledAgain();
	target.remove();
});

describe('offering an assistant', () => {
	it('is off, and asks the device what it has the moment it is turned on', async () => {
		show();
		await settle();
		expect(screen()).toContain('Work with an assistant');
		expect(screen()).not.toContain('on this machine');
		expect(looked).toBe(0);

		toggle()?.click();
		await settle();

		expect(prefs.current.aiOffered).toBe(true);
		expect(looked).toBe(1);
		expect(screen()).toContain('Claude Code · on this machine');
		expect(button('Give a key')).toBeDefined();
		expect(chat.offered).toBe(true);
	});

	it('keeps a key here, says what keeps it, and forgets it again', async () => {
		prefs.set('aiOffered', true);
		show();
		await settle();

		button('Give a key')?.click();
		await settle();
		const field = target.querySelector<HTMLInputElement>('input[type="password"]');
		expect(field?.getAttribute('aria-label')).toBe('Key for Anthropic');
		if (!field) throw new Error('nowhere to paste');
		field.value = ' sk-ant-1 ';
		field.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		button('Keep it here')?.click();
		await settle();

		expect(keys.given).toEqual(['anthropic= sk-ant-1 ']);
		expect(screen()).toContain("Anthropic · A key is kept here, in this device's secure hardware.");
		expect(target.querySelector('input[type="password"]')).toBeNull();
		expect(chat.agents).toEqual(['claude_code', 'anthropic']);

		button('Forget it')?.click();
		await settle();
		expect(keys.held_).toEqual([]);
		expect(screen()).not.toContain('A key is kept here');
		expect(chat.agents).toEqual(['claude_code']);
	});

	it('offers to keep answering while somebody is elsewhere, and only once it is offered at all', async () => {
		show();
		await settle();
		expect(screen()).not.toContain('Keep answering while you are elsewhere');

		toggle()?.click();
		await settle();

		expect(screen()).toContain('Keep answering while you are elsewhere');
		expect(prefs.current.chatInBackground).toBe(false);

		switches()[1]?.click();
		await settle();

		expect(prefs.current.chatInBackground).toBe(true);
	});

	it('lets the assistant read the web until somebody says not', async () => {
		prefs.set('aiOffered', true);
		show();
		await settle();

		expect(screen()).toContain('Let it read the web');
		expect(prefs.current.chatReachesWeb).toBe(true);

		switches()[2]?.click();
		await settle();

		expect(prefs.current.chatReachesWeb).toBe(false);
	});

	// Asking for chats to wait reaches the ones already standing out of sight,
	// not only the next thread somebody leaves.
	it('leaves the threads standing out of sight when it is turned off again', async () => {
		const waits = vi.spyOn(chat, 'leaveTheOthers');
		prefs.set('aiOffered', true);
		prefs.set('chatInBackground', true);
		show();
		await settle();

		switches()[1]?.click();
		await settle();

		expect(prefs.current.chatInBackground).toBe(false);
		expect(waits).toHaveBeenCalledTimes(1);

		switches()[1]?.click();
		await settle();

		expect(prefs.current.chatInBackground).toBe(true);
		expect(waits).toHaveBeenCalledTimes(1);
		waits.mockRestore();
	});

	it('says nothing here can answer where the switch is on and nothing does', async () => {
		programs = [];
		prefs.set('aiOffered', true);
		show();
		await settle();

		expect(screen()).toContain('Claude Code · not on this machine');
		expect(screen()).toContain(
			'Nothing here can answer yet. Install Claude Code, or give a key above.'
		);
		expect(chat.offered).toBe(false);
	});
});

const ear: SpeechAccess = { hear: async () => ({ said: '' }) };

/** A desk with a speech program installed or not, which picks `file` when asked. */
function aProgram(here: boolean, file?: string): SpeechProgramAccess & { looked: number } {
	const program = {
		looked: 0,
		present: async () => {
			program.looked += 1;
			return here;
		},
		pickModel: async () => file
	};
	return program;
}

/** A computer whose own recogniser is here or not, allowed or not, with a
 *  microphone allowed or not, and which counts the times it asked the person
 *  about each. */
function aSystem(
	here: boolean,
	allowed: SpeechSystemAllowed = 'authorized',
	answer: SpeechSystemAllowed = 'authorized',
	{
		microphone = 'authorized',
		microphoneAnswer = 'authorized'
	}: { microphone?: SpeechSystemAllowed; microphoneAnswer?: SpeechSystemAllowed } = {}
): SpeechSystemAccess & { asked: number; askedMicrophone: number } {
	const system = {
		asked: 0,
		askedMicrophone: 0,
		present: async () => here,
		allowed: async () => allowed,
		authorize: async () => {
			system.asked += 1;
			if (allowed === 'undecided') allowed = answer;
			return allowed;
		},
		microphone: async () => microphone,
		allowMicrophone: async () => {
			system.askedMicrophone += 1;
			if (microphone === 'undecided') microphone = microphoneAnswer;
			return microphone;
		}
	};
	return system;
}

const radio = (words: string): HTMLElement => {
	const found = [...document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
		(row) => row.textContent?.trim() === words
	);
	if (!found) throw new Error(`The menu does not offer "${words}"`);
	return found;
};
const radios = () =>
	[...document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].map((row) =>
		row.textContent?.trim()
	);

async function pick(trigger: string, choice: string): Promise<void> {
	button(trigger)?.click();
	await settle();
	radio(choice).click();
	await settle();
}

describe('hearing a headset', () => {
	beforeEach(() => {
		prefs.set('aiOffered', true);
	});

	it('says speech is set up in the app on a computer where this one cannot hear', async () => {
		show();
		await settle();

		expect(screen()).toContain(
			'Speaking from a headset is set up in the Sloppy app on a computer.'
		);
		expect(button('Nothing')).toBeUndefined();
	});

	it('keeps the agent chosen, and offers the models of the one chosen', async () => {
		initRuntime({ apiHost: () => '', chat: access, aiKeys: keys, speech: ear });
		show();
		await settle();

		button('Nothing')?.click();
		await settle();
		expect(radios()).toEqual(['Nothing', 'OpenAI', 'Groq']);
		radio('Groq').click();
		await settle();

		expect(prefs.current.speechAgent).toBe('groq');
		expect(screen()).toContain('What you say is sent to Groq to be turned into words.');
		button('whisper-large-v3-turbo')?.click();
		await settle();
		expect(radios()).toEqual(['whisper-large-v3-turbo', 'whisper-large-v3']);
		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await settle();

		await pick('Groq', 'OpenAI');
		await pick('gpt-4o-mini-transcribe', 'whisper-1');

		expect(prefs.current.speechAgent).toBe('openai');
		expect(prefs.current.speechModel).toEqual({ openai: 'whisper-1' });

		if (mounted) unmount(mounted, { outro: false });
		show();
		await settle();
		expect(button('OpenAI')).toBeDefined();
		expect(button('whisper-1')).toBeDefined();
	});

	it('reads a program chosen elsewhere as nothing where no program can hear', async () => {
		prefs.set('speechAgent', 'whisper_cpp');
		initRuntime({ apiHost: () => '', chat: access, aiKeys: keys, speech: ear });
		show();
		await settle();

		expect(button('Nothing')).toBeDefined();
		expect(screen()).not.toContain('whisper.cpp');
	});

	it("reads the assistant's key for an agent that also answers, with one form for it", async () => {
		prefs.set('speechAgent', 'openai');
		initRuntime({ apiHost: () => '', chat: access, aiKeys: keys, speech: ear });
		show();
		await settle();

		expect(screen()).toContain('OpenAI · give a key above, and it serves both');
		const offers = () =>
			[...target.querySelectorAll('button')].filter(
				(one) => one.textContent?.trim() === 'Give a key'
			);
		offers()[1]?.click();
		await settle();
		expect(target.querySelectorAll('input[aria-label="Key for OpenAI"]')).toHaveLength(1);
		const field = target.querySelector<HTMLInputElement>('input[aria-label="Key for OpenAI"]');
		if (!field) throw new Error('nowhere to paste');
		field.value = 'sk-1';
		field.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		button('Keep it here')?.click();
		await settle();

		expect(keys.given).toEqual(['openai=sk-1']);
		expect(screen()).toContain('OpenAI · uses the key above');
		expect(
			[...target.querySelectorAll('button')].filter(
				(one) => one.textContent?.trim() === 'Forget it'
			)
		).toHaveLength(1);
	});

	it("keeps a key for the agent that hears, beside the assistant's", async () => {
		prefs.set('speechAgent', 'groq');
		initRuntime({ apiHost: () => '', chat: access, aiKeys: keys, speech: ear });
		show();
		await settle();

		const offers = [...target.querySelectorAll('button')].filter(
			(one) => one.textContent?.trim() === 'Give a key'
		);
		offers.at(-1)?.click();
		await settle();
		const field = target.querySelector<HTMLInputElement>('input[aria-label="Key for Groq"]');
		if (!field) throw new Error('nowhere to paste');
		field.value = 'gsk-1';
		field.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		button('Keep it here')?.click();
		await settle();

		expect(keys.given).toEqual(['groq=gsk-1']);
		expect(screen()).toContain("Groq · A key is kept here, in this device's secure hardware.");
		expect(chat.agents).toEqual(['claude_code']);
	});

	it('hears with a program here: says whether it is installed, and keeps the model file picked', async () => {
		const program = aProgram(true, '/Users/me/models/ggml-base.en.bin');
		initRuntime({
			apiHost: () => '',
			chat: access,
			aiKeys: keys,
			speech: ear,
			speechProgram: program
		});
		show();
		await settle();

		await pick('Nothing', 'A program on this computer');

		expect(prefs.current.speechAgent).toBe('whisper_cpp');
		expect(program.looked).toBe(1);
		expect(screen()).toContain('whisper.cpp · on this computer');
		expect(screen()).toContain('No model chosen yet.');
		expect(screen()).not.toContain('Model ·');

		button('Choose a model file')?.click();
		await settle();

		expect(prefs.current.speechProgramModel).toBe('/Users/me/models/ggml-base.en.bin');
		expect(screen()).toContain('Model · ggml-base.en.bin');
		expect(button('Choose another')).toBeDefined();
		expect(screen()).toContain('Heard on this computer; nothing leaves it.');
	});

	it('says when the program is not on this computer, and keeps the file it had when nothing is picked', async () => {
		prefs.set('speechAgent', 'whisper_cpp');
		prefs.set('speechProgramModel', '/models/ggml-small.bin');
		initRuntime({
			apiHost: () => '',
			chat: access,
			aiKeys: keys,
			speech: ear,
			speechProgram: aProgram(false)
		});
		show();
		await settle();

		expect(screen()).toContain('whisper.cpp · not on this computer');
		button('Choose another')?.click();
		await settle();
		expect(prefs.current.speechProgramModel).toBe('/models/ggml-small.bin');
	});

	it('hears with this computer where nothing else is chosen, and asks nobody anything for it', async () => {
		const system = aSystem(true, 'undecided');
		initRuntime({
			apiHost: () => '',
			chat: access,
			aiKeys: keys,
			speech: ear,
			speechSystem: system
		});
		show();
		await settle();

		expect(button('This computer')).toBeDefined();
		expect(screen()).toContain('Heard on this computer; nothing leaves it.');
		expect(system.asked).toBe(0);
		button('This computer')?.click();
		await settle();
		expect(radios()).toEqual(['This computer', 'OpenAI', 'Groq']);
		radio('Groq').click();
		await settle();
		expect(prefs.current.speechAgent).toBe('groq');
		expect(screen()).not.toContain('Heard on this computer');
	});

	it('asks the person once when this computer is chosen, and says where to allow it if they did not', async () => {
		prefs.set('speechAgent', 'groq');
		const system = aSystem(true, 'undecided', 'denied');
		initRuntime({
			apiHost: () => '',
			chat: access,
			aiKeys: keys,
			speech: ear,
			speechSystem: system
		});
		show();
		await settle();

		await pick('Groq', 'This computer');

		expect(prefs.current.speechAgent).toBe('system');
		expect(system.asked).toBe(1);
		expect(screen()).toContain(
			'Allow Sloppy to use speech recognition in System Settings → Privacy & Security → Speech Recognition.'
		);

		await pick('This computer', 'OpenAI');
		await pick('OpenAI', 'This computer');
		expect(system.asked).toBe(1);
	});

	it('says this computer cannot hear yet where it has no recogniser, and offers the rest', async () => {
		initRuntime({
			apiHost: () => '',
			chat: access,
			aiKeys: keys,
			speech: ear,
			speechSystem: aSystem(false)
		});
		show();
		await settle();

		expect(screen()).toContain('This computer cannot hear yet.');
		button('Nothing')?.click();
		await settle();
		expect(radios()).toEqual(['Nothing', 'OpenAI', 'Groq']);
	});

	describe('whether this computer may listen and hear', () => {
		function standing(system: SpeechSystemAccess): void {
			initRuntime({
				apiHost: () => '',
				chat: access,
				aiKeys: keys,
				speech: ear,
				speechSystem: system
			});
		}

		it('says yes where both are allowed, and offers nothing to allow', async () => {
			standing(aSystem(true));
			show();
			await settle();

			expect(screen()).toContain('This computer may listen and hear · yes');
			expect(button('Allow')).toBeUndefined();
			expect(target.querySelector('[role="alert"]')).toBeNull();
		});

		it('says not yet while either is unasked, and Allow asks both', async () => {
			const system = aSystem(true, 'undecided', 'authorized', { microphone: 'undecided' });
			standing(system);
			show();
			await settle();

			expect(screen()).toContain('This computer may listen and hear · not yet');
			expect(system.asked + system.askedMicrophone).toBe(0);
			button('Allow')?.click();
			await settle();

			expect(system.askedMicrophone).toBe(1);
			expect(system.asked).toBe(1);
			expect(screen()).toContain('This computer may listen and hear · yes');
			expect(button('Allow')).toBeUndefined();
		});

		it('says no where either was refused, and where to allow each one', async () => {
			standing(
				aSystem(true, 'authorized', 'authorized', {
					microphone: 'undecided',
					microphoneAnswer: 'denied'
				})
			);
			show();
			await settle();

			button('Allow')?.click();
			await settle();

			expect(screen()).toContain('This computer may listen and hear · no');
			expect(screen()).toContain(
				'Allow Sloppy to use the microphone in System Settings → Privacy & Security → Microphone.'
			);
			expect(screen()).not.toContain('Speech Recognition.');
			expect(button('Allow')).toBeUndefined();
		});

		it('is not said where this computer cannot hear', async () => {
			standing(aSystem(false));
			show();
			await settle();

			expect(screen()).not.toContain('may listen and hear');
		});
	});
});
