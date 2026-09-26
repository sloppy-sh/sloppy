// The surface a maintainer chats about a project's notes on —
// docs/ARCHITECTURE.md § "Asking a tool to write the notes". Nothing here
// starts a program: the seam is a stand-in throughout.

import 'fake-indexeddb/auto';
import type {
	ChatAgent,
	ChatBlock,
	ChatCallId,
	ChatEvent,
	ChatToolAnswer,
	ChatToolCall,
	OwnedRef
} from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NoteLanding } from '../pages/page-state.js';
import { type ChatAccess, type ChatAsked, initRuntime } from '../runtime.js';
import { seamSettledAgain } from '../seam.svelte.js';
import { chat } from '../stores/chat.svelte.js';
import {
	DID,
	homeOf,
	node,
	ref,
	useFakeApi,
	VIEWER,
	type FakeApi
} from '../stores/fake-api.test-support.js';
import { nodes } from '../stores/nodes.svelte.js';
import { session } from '../stores/session.svelte.js';
import ChatSheet from './chat-sheet.svelte';

const HOME = homeOf(DID);
const PARSER = ref(1);

class Stub implements ChatAccess {
	agent: readonly ChatAgent[] = ['claude_code'];
	/** Set while this device is to reject the ask rather than answer it. */
	untold = false;
	readonly asked: ChatAsked[] = [];
	readonly said: string[] = [];
	readonly answered: { call: ChatCallId; allowed: boolean }[] = [];
	stops = 0;
	closes = 0;
	#hear: ((event: ChatEvent) => void) | null = null;
	#serve: ((call: ChatToolCall) => Promise<ChatToolAnswer>) | null = null;

	agents(): Promise<ChatAgent[]> {
		if (this.untold) return Promise.reject(new Error('no bridge'));
		return Promise.resolve([...this.agent]);
	}

	open(
		asked: ChatAsked,
		hear: (event: ChatEvent) => void,
		serve: (call: ChatToolCall) => Promise<ChatToolAnswer>
	): Promise<void> {
		this.asked.push(asked);
		this.#hear = hear;
		this.#serve = serve;
		return Promise.resolve();
	}

	say(said: string): Promise<void> {
		this.said.push(said);
		return Promise.resolve();
	}

	settle(call: ChatCallId, allowed: boolean): Promise<void> {
		this.answered.push({ call, allowed });
		this.tell({ event: 'settled', call, allowed });
		return Promise.resolve();
	}

	stop(): Promise<void> {
		this.stops += 1;
		this.tell({ event: 'ended', stopped: true });
		return Promise.resolve();
	}

	close(): Promise<void> {
		this.closes += 1;
		return Promise.resolve();
	}

	/** What the shell would tell the page while a session runs. */
	tell(event: ChatEvent): void {
		this.#hear?.(event);
	}

	/** Whether the page handed the shell something to do its acts with. */
	get serves(): boolean {
		return this.#serve !== null;
	}
}

function stubViewport(width: number): void {
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: (query: string) => ({
			matches: /max-width:\s*(\d+)px/.test(query)
				? width <= Number(/max-width:\s*(\d+)px/.exec(query)?.[1])
				: false,
			addEventListener: () => {},
			removeEventListener: () => {}
		})
	});
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 20; turn += 1) {
		await new Promise((wake) => setTimeout(wake));
		flushSync();
	}
}

const screen = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

const named = (words: string): HTMLButtonElement | undefined =>
	[...document.body.querySelectorAll('button')].find((one) => one.textContent?.trim() === words);

const labelled = (label: string): HTMLButtonElement | undefined =>
	[...document.body.querySelectorAll('button')].find(
		(one) => one.getAttribute('aria-label') === label
	);

const composer = (): HTMLTextAreaElement => {
	const found = document.body.querySelector<HTMLTextAreaElement>(
		'[aria-label="What you want written about"]'
	);
	if (!found) throw new Error('no composer');
	return found;
};

function type(words: string): void {
	const into = composer();
	into.value = words;
	into.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

let stub: Stub;
let api: FakeApi;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let opened: { note: OwnedRef; at?: NoteLanding }[];

function show(): void {
	mounted = mount(ChatSheet, {
		target,
		props: {
			open: true,
			onOpen: (note: OwnedRef, at?: NoteLanding) =>
				opened.push({ note, ...(at === undefined ? {} : { at }) })
		}
	});
	flushSync();
}

/** The chat open, with one thing said into it and the turn underway. */
async function saying(words = 'What is in here?'): Promise<void> {
	await chat.opened(HOME);
	show();
	await settle();
	type(words);
	labelled('Send')?.click();
	await settle();
}

beforeEach(async () => {
	nodes.clear();
	chat.clear();
	opened = [];
	stub = new Stub();
	api = useFakeApi();
	api.on('GET /nodes', () => [node(1, '1', { title: 'The parser' })]);
	session.adopt(VIEWER, 'a-session');
	await nodes.load({ graph: HOME });
	initRuntime({ apiHost: () => 'http://api.test', chat: stub });
	seamSettledAgain();
	stubViewport(390);
	Object.defineProperty(globalThis, 'ResizeObserver', {
		configurable: true,
		writable: true,
		value: class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	});
	Element.prototype.hasPointerCapture = () => false;
	Element.prototype.setPointerCapture = () => {};
	Element.prototype.releasePointerCapture = () => {};
	Element.prototype.scrollIntoView = () => {};
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	chat.clear();
	nodes.clear();
	session.clear();
	initRuntime({ apiHost: () => '', chat: undefined });
	seamSettledAgain();
	target.remove();
	document.body.innerHTML = '';
});

describe('a device with nothing to chat to', () => {
	it('says so in one line and offers nothing that would fail', async () => {
		stub.agent = [];
		await chat.opened(HOME);
		show();
		await settle();

		expect(screen()).toContain('Claude Code');
		expect(screen()).toContain('not on this machine');
		expect(labelled('Send')).toBeUndefined();
	});

	it('says an ask that went nowhere went nowhere, not that there is nothing', async () => {
		stub.untold = true;
		await chat.opened(HOME);
		show();
		await settle();

		expect(screen()).toContain('could not tell');
		expect(screen()).not.toContain('not on this machine');
		expect(screen()).not.toContain('bridge');
		expect(named('Look again')).toBeDefined();
	});
});

describe('a turn', () => {
	it('carries what was typed, and hands the shell a way to do Sloppy’s acts', async () => {
		await saying('Write about the parser');

		expect(stub.said).toEqual(['Write about the parser']);
		expect(stub.serves).toBe(true);
		expect(screen()).toContain('Write about the parser');
	});

	it('draws the answer as it arrives, a block that grows replacing itself', async () => {
		await saying();
		stub.tell({ event: 'block', at: 0, block: { kind: 'said', said: 'Reading the' } });
		await settle();

		expect(screen()).toContain('Reading the');

		stub.tell({ event: 'block', at: 0, block: { kind: 'said', said: 'Reading the parser.' } });
		await settle();

		expect(screen()).toContain('Reading the parser.');
		expect(screen().match(/Reading the/g)).toHaveLength(1);
	});

	it('folds thinking away, quietly', async () => {
		await saying();
		stub.tell({ event: 'block', at: 0, block: { kind: 'thinking', said: 'Where is the parser' } });
		await settle();

		const folded = document.body.querySelector('details');
		expect(folded).not.toBeNull();
		expect(folded?.open).toBe(false);
		expect(screen()).toContain('Thinking');
	});

	it('skips a block of a kind it has no row for, and draws the rest', async () => {
		await saying();
		stub.tell({ event: 'block', at: 0, block: { kind: 'said', said: 'Reading the parser.' } });
		stub.tell({
			event: 'block',
			at: 1,
			block: { kind: 'a-kind-from-later', shown: 'a picture' } as ChatBlock
		});
		stub.tell({ event: 'block', at: 2, block: { kind: 'said', said: 'That is all of it.' } });
		await settle();

		expect(screen()).toContain('Reading the parser.');
		expect(screen()).toContain('That is all of it.');
		expect(screen()).not.toContain('a picture');
	});

	it('is over when the turn ends, and can be said into again', async () => {
		await saying();
		expect(labelled('Stop')).toBeDefined();

		stub.tell({ event: 'ended' });
		await settle();

		expect(labelled('Stop')).toBeUndefined();
		expect(labelled('Send')).toBeDefined();
	});

	it('carries the words of a session that could not go on', async () => {
		await saying();
		stub.tell({ event: 'over', said: 'That is more than Sloppy can read at once.' });
		await settle();

		expect(screen()).toContain('That is more than Sloppy can read at once.');
	});
});

describe('an act in the thread', () => {
	it('reads as what it is doing to the notes, never as the call', async () => {
		await saying();
		stub.tell({
			event: 'block',
			at: 0,
			block: {
				kind: 'tool_call',
				call: 'c1',
				tool: 'mcp__sloppy__write_note',
				act: 'write_note',
				arguments: { about: 'src/parser.ts', title: 'The parser', sections: ['## Why\n\nBecause.'] }
			}
		});
		await settle();

		expect(screen()).toContain('Writing a note');
		expect(screen()).toContain('src/parser.ts');
		expect(screen()).not.toContain('mcp__sloppy__write_note');
	});

	it('says what it came to, and offers the note it left', async () => {
		await saying();
		stub.tell({
			event: 'block',
			at: 0,
			block: {
				kind: 'tool_call',
				call: 'c1',
				tool: 'write_note',
				act: 'write_note',
				arguments: { about: 'src/parser.ts', sections: ['## Why\n\nBecause.'] }
			}
		});
		stub.tell({
			event: 'block',
			at: 1,
			block: {
				kind: 'tool_result',
				call: 'c1',
				said: JSON.stringify({ note: PARSER, done: 'written' })
			}
		});
		await settle();

		expect(screen()).toContain('Written.');
		expect(screen()).not.toContain('done');
		named('Open 1 · The parser')?.click();
		await settle();

		expect(opened).toEqual([{ note: PARSER }]);
		expect(document.body.querySelector('[aria-label="What you want written about"]')).toBeNull();
	});

	it('sends somebody to what is offered on a note they have written in', async () => {
		await saying();
		stub.tell({
			event: 'block',
			at: 0,
			block: {
				kind: 'tool_call',
				call: 'c1',
				tool: 'write_note',
				act: 'write_note',
				arguments: { about: 'src/parser.ts', sections: ['## Why\n\nBecause.'] }
			}
		});
		stub.tell({
			event: 'block',
			at: 1,
			block: {
				kind: 'tool_result',
				call: 'c1',
				said: JSON.stringify({ note: PARSER, done: 'offered' })
			}
		});
		await settle();

		expect(screen()).toContain('A change is offered on it.');
		named('Open 1 · The parser')?.click();
		await settle();

		expect(opened).toEqual([{ note: PARSER, at: 'offers' }]);
	});

	it('draws a tool of the agent’s own by its name and what it is on', async () => {
		await saying();
		stub.tell({
			event: 'block',
			at: 0,
			block: { kind: 'tool_call', call: 'c2', tool: 'Read', arguments: { file: 'src/parser.ts' } }
		});
		await settle();

		expect(screen()).toContain('Read');
		expect(screen()).toContain('src/parser.ts');
	});
});

describe('the answer a write waits on', () => {
	async function asking(): Promise<void> {
		await saying();
		stub.tell({
			event: 'asking',
			call: 'c9',
			act: 'write_note',
			arguments: {
				about: 'src/parser.ts',
				title: 'The parser',
				sections: ['## Why\n\nBecause.'],
				tags: ['parser']
			}
		});
		await settle();
	}

	it('says what it wants to do, and writes nothing until it is answered', async () => {
		await asking();

		expect(screen()).toContain('It wants to write');
		expect(screen()).toContain('The parser');
		expect(screen()).toContain('src/parser.ts');
		expect(screen()).toContain('It would tag it parser.');
		expect(named('Allow')).toBeDefined();
		expect(stub.answered).toEqual([]);
	});

	it('lets it through on Allow, and closes the question', async () => {
		await asking();
		named('Allow')?.click();
		await settle();

		expect(stub.answered).toEqual([{ call: 'c9', allowed: true }]);
		expect(screen()).not.toContain('It wants to write');
	});

	it('turns it down, and the agent is told so', async () => {
		await asking();
		named('Don’t')?.click();
		await settle();

		expect(stub.answered).toEqual([{ call: 'c9', allowed: false }]);
		expect(screen()).not.toContain('It wants to write');
	});
});

describe('the composer', () => {
	it('sends on Enter and makes a line on Shift+Enter', async () => {
		await chat.opened(HOME);
		show();
		await settle();

		type('The first thing');
		composer().dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })
		);
		await settle();
		expect(stub.said).toEqual([]);

		composer().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await settle();
		expect(stub.said).toEqual(['The first thing']);
	});

	it('ends the turn underway where Stop is taken', async () => {
		await saying();
		labelled('Stop')?.click();
		await settle();

		expect(stub.stops).toBe(1);
		expect(labelled('Send')).toBeDefined();
	});
});
