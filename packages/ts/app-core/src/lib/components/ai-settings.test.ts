import type { AiKeysAccess, KeyHeldFor } from '@sloppy/local';
import type { ChatAgent } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ChatAccess, initRuntime } from '../runtime.js';
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
		hold: async (provider: ChatAgent, secret: string) => {
			given.push(`${provider}=${secret}`);
			held_.push({ provider, backing: 'hardware' });
			return 'hardware';
		},
		forget: async (provider: ChatAgent) => {
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
		return [...programs, ...(await keys.held()).map((one) => one.provider)];
	},
	open: async () => {},
	say: async () => {},
	stop: async () => {},
	close: async () => {}
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

function show(): void {
	mounted = mount(AiSettings, { target });
	flushSync();
}

beforeEach(() => {
	keys = keysHolding();
	programs = ['claude_code'];
	looked = 0;
	prefs.set('aiOffered', false);
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
	chat.clear();
	initRuntime({ apiHost: () => '', chat: undefined, aiKeys: undefined });
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
