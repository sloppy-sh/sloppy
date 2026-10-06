// The surface a maintainer chats about a project's notes on —
// docs/ARCHITECTURE.md § "Asking a tool to write the notes". Nothing here
// starts a program: the seam is a stand-in throughout.

import 'fake-indexeddb/auto';
import { MemoryFiles } from '@sloppy/local';
import { CHAT_ATTACHMENT_MAX, chatCard } from '@sloppy/types';
import type {
	ChatActDone,
	ChatAgent,
	ChatBlock,
	ChatCallId,
	ChatEvent,
	ChatToolAnswer,
	ChatToolCall,
	ChatToolName,
	OwnedRef
} from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoteLanding } from '../pages/page-state.js';
import { type ChatAccess, type ChatAsked, initRuntime } from '../runtime.js';
import { seamSettledAgain } from '../seam.svelte.js';
import { chat } from '../stores/chat.svelte.js';
import { offers } from '../stores/offers.svelte.js';
import { prefs } from '../stores/prefs.svelte.js';
import {
	amendment,
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
import ChatPanel from './chat-panel.svelte';

/** The acts themselves are the other half of this seam: what one ANSWERS the
 *  person is composed where the act is done, and this is what the page makes
 *  of it. */
const acting = vi.hoisted(() => ({
	answer: { said: '{}' } as ChatActDone,
	called: [] as { act: string }[]
}));

vi.mock('../chat-acts.js', () => ({
	serveChatCall: (_files: unknown, call: { act: string }) => {
		acting.called.push(call);
		return Promise.resolve(acting.answer);
	}
}));

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

	/** Nothing calls this any more; it is here because the seam still declares
	 *  it, and `answered` is what a test reads to prove nothing did. */
	settle(call: ChatCallId, allowed: boolean): Promise<void> {
		this.answered.push({ call, allowed });
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

	/** One of Sloppy's own acts, asked of the page the way the shell asks. */
	serve(call: ChatToolCall): Promise<ChatToolAnswer> {
		if (!this.#serve) throw new Error('nothing is serving');
		return this.#serve(call);
	}
}

/** A phone, and a desk wide enough for a graph with the chat docked beside it. */
const PHONE = 390;
const DESK = 1440;

function stubViewport(width: number): void {
	Object.defineProperty(globalThis, 'innerWidth', {
		configurable: true,
		writable: true,
		value: width
	});
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: (query: string) => {
			const most = /max-width:\s*(\d+)px/.exec(query);
			const least = /min-width:\s*(\d+)px/.exec(query);
			return {
				matches: most ? width <= Number(most[1]) : least ? width >= Number(least[1]) : false,
				addEventListener: () => {},
				removeEventListener: () => {}
			};
		}
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

/** Whether the chat is still there to be said into. */
const composerThere = (): boolean =>
	document.body.querySelector('[aria-label="What you want written about"]') !== null;

/** What `<html>` is told everything docked on the right takes, together. */
const dockInset = () =>
	document.documentElement.style.getPropertyValue('--reading-dock-inset-right');

const composer = (): HTMLTextAreaElement => {
	const found = document.body.querySelector<HTMLTextAreaElement>(
		'[aria-label="What you want written about"]'
	);
	if (!found) throw new Error('no composer');
	return found;
};

/** A note's `<did>/<ulid>` as a route's two path segments. */
function refPath(note: OwnedRef): string {
	const cut = note.lastIndexOf('/');
	return `/${encodeURIComponent(note.slice(0, cut))}/${encodeURIComponent(note.slice(cut + 1))}`;
}

function type(words: string): void {
	const into = composer();
	into.value = words;
	into.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

let stub: Stub;
let api: FakeApi;
let files: MemoryFiles;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let opened: { note: OwnedRef; at?: NoteLanding }[];

function show(): void {
	mounted = mount(ChatPanel, {
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
	offers.clear();
	prefs.set('chatModel', {});
	prefs.set('chatAgent', null);
	opened = [];
	acting.answer = { said: '{}' };
	acting.called.length = 0;
	stub = new Stub();
	files = new MemoryFiles({ root: '/home/ada/garden', store: new Map(), data: '/data' });
	api = useFakeApi();
	api.on('GET /nodes', () => [
		node(1, '1', { title: 'The parser' }),
		node(2, '1a', { title: 'The vault' })
	]);
	session.adopt(VIEWER, 'a-session');
	await nodes.load({ graph: HOME });
	initRuntime({ apiHost: () => 'http://api.test', chat: stub, project: async () => files });
	seamSettledAgain();
	stubViewport(PHONE);
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
	offers.clear();
	session.clear();
	initRuntime({ apiHost: () => '', chat: undefined, project: undefined });
	seamSettledAgain();
	target.remove();
	document.body.innerHTML = '';
});

// DESIGN.md § Layout: the chat is a dock beside the graph, so a person can read
// the note it wrote while the conversation is still in front of them.
describe('where the chat stands', () => {
	afterEach(() => prefs.set('chatWidth', null));

	it('docks beside the graph where there is room, rather than standing over it', async () => {
		prefs.set('chatWidth', 400);
		stubViewport(DESK);
		await chat.opened(HOME);
		show();
		await settle();

		expect(document.body.querySelector('aside[aria-label="Chat about the code"]')).not.toBeNull();
		expect(document.body.querySelector('[role="dialog"]')).toBeNull();
		expect(dockInset()).toBe('400px');
	});

	it('is the whole screen on a phone, where there is no graph to stand beside', async () => {
		prefs.set('chatWidth', 400);
		await chat.opened(HOME);
		show();
		await settle();

		expect(document.body.querySelector('aside[aria-label="Chat about the code"]')).toBeNull();
		expect(document.body.querySelector('[data-slot="modal-grabber"]')).not.toBeNull();
		expect(dockInset()).toBe('');
	});

	it('gives the graph its width back when it is put away', async () => {
		prefs.set('chatWidth', 400);
		stubViewport(DESK);
		await chat.opened(HOME);
		show();
		await settle();
		expect(dockInset()).toBe('400px');

		labelled('Close the chat')?.click();
		await settle();

		expect(dockInset()).toBe('');
	});

	it('moves the wall between it and the graph by the arrow keys', async () => {
		prefs.set('chatWidth', 400);
		stubViewport(DESK);
		await chat.opened(HOME);
		show();
		await settle();

		const wall = document.body.querySelector<HTMLElement>('[role="separator"]');
		wall?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
		await settle();

		expect(dockInset()).toBe('424px');
		expect(prefs.current.chatWidth).toBe(424);
	});
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

	/** One act called, done by the page and echoed back by the shell, which is
	 *  the order a turn puts them in. */
	async function did(act: ChatToolName, args: unknown, done: ChatActDone): Promise<void> {
		stub.tell({
			event: 'block',
			at: 0,
			block: { kind: 'tool_call', call: 'c1', tool: act, act, arguments: args }
		});
		acting.answer = done;
		await stub.serve({ call: 'c1', act, arguments: args } as ChatToolCall);
		stub.tell({
			event: 'block',
			at: 1,
			block: { kind: 'tool_result', call: 'c1', said: done.said }
		});
		await settle();
	}

	it('lays out what the act said, and never what the agent was handed', async () => {
		await saying();
		await did(
			'write_note',
			{ about: 'src/parser.ts', sections: ['## Why\n\nBecause.'] },
			{
				said: JSON.stringify({ note: PARSER, done: 'written' }),
				told: 'Written.',
				card: chatCard('note', 'The parser', [{ label: 'Place', value: 'src/parser.ts' }]),
				touched: [PARSER]
			}
		);

		expect(screen()).toContain('Written.');
		expect(screen()).toContain('Place');
		expect(screen()).not.toContain('done');
		named('Open 1 · The parser')?.click();
		await settle();

		expect(opened).toEqual([{ note: PARSER }]);
	});

	it('sends somebody to what is offered on a note they have written in', async () => {
		api.on(`GET /nodes${refPath(PARSER)}/amendments`, () => [amendment(90, PARSER, DID)]);
		await saying();
		await did(
			'write_note',
			{ about: 'src/parser.ts', sections: ['## Why\n\nBecause.'] },
			{
				said: JSON.stringify({ note: PARSER, done: 'offered' }),
				told: 'A change is offered on it.',
				touched: [PARSER]
			}
		);

		expect(screen()).toContain('A change is offered on it.');
		named('Open 1 · The parser')?.click();
		await settle();

		expect(opened).toEqual([{ note: PARSER, at: 'offers' }]);
	});

	it('draws a search as what was looked for and how much it reached', async () => {
		await saying();
		await did(
			'search_notes',
			{ words: 'lexer tokens' },
			{ said: JSON.stringify({ found: [] }), told: '1 note' }
		);

		expect(screen()).toContain('Looking through the notes');
		expect(screen()).toContain('lexer tokens');
		expect(screen()).toContain('1 note');
		expect(named('Open 1 · The parser')).toBeUndefined();
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

describe('a write with nothing in its way', () => {
	/** The gate is gone: a session works in a draft, so an act that writes is
	 *  done when it is called and nobody is interrupted. */
	function writing(call: string, about: string): ChatToolCall {
		return {
			call,
			act: 'write_note',
			arguments: { about, sections: ['## Why\n\nBecause.'] }
		} as ChatToolCall;
	}

	it('is served and answered with no question put in front of anybody', async () => {
		await saying();

		const answer = await stub.serve(writing('c9', 'src/parser.ts'));

		expect(answer).toEqual({ said: '{}' });
		expect(acting.called.map((one) => one.act)).toEqual(['write_note']);
		expect(stub.answered).toEqual([]);
		expect(named('Allow')).toBeUndefined();
		expect(named('Don\u2019t')).toBeUndefined();
		expect(named('Allow the rest of this reply')).toBeUndefined();
		expect(named('Stop asking')).toBeUndefined();
		expect(screen()).not.toContain('Nothing is written until you say so.');
	});

	/** The endpoint serves each call on a thread of its own, so a pass over a
	 *  repository calls several at once. Every one of them lands. */
	it('serves every act of a reply that calls them together', async () => {
		await saying('Document the packages');

		const answers = await Promise.all(
			['c1', 'c2', 'c3'].map((call) => stub.serve(writing(call, `packages/${call}`)))
		);

		expect(answers).toHaveLength(3);
		expect(acting.called).toHaveLength(3);
		expect(stub.answered).toEqual([]);
	});
});

// The point of a side view is reading the note while the conversation stays up.
// Two full-height sheets cannot both be on a phone, so there the chat steps
// aside and the note is what was asked for.
describe('opening a note the chat wrote', () => {
	afterEach(() => prefs.set('chatWidth', null));

	async function wrote(): Promise<void> {
		const asked = { about: 'src/parser.ts', sections: ['## Why\n\nBecause.'] };
		await saying();
		stub.tell({
			event: 'block',
			at: 0,
			block: {
				kind: 'tool_call',
				call: 'c1',
				tool: 'write_note',
				act: 'write_note',
				arguments: asked
			}
		});
		acting.answer = { said: '{}', told: 'Written.', touched: [PARSER] };
		await stub.serve({ call: 'c1', act: 'write_note', arguments: asked } as ChatToolCall);
		stub.tell({ event: 'block', at: 1, block: { kind: 'tool_result', call: 'c1', said: '{}' } });
		await settle();
	}

	it('leaves the conversation up where the chat is docked beside the graph', async () => {
		prefs.set('chatWidth', 400);
		stubViewport(DESK);
		await wrote();

		named('Open 1 \u00b7 The parser')?.click();
		await settle();

		expect(opened).toEqual([{ note: PARSER }]);
		expect(composerThere()).toBe(true);
	});

	it('steps aside on a phone, where the note is the whole screen', async () => {
		await wrote();

		named('Open 1 \u00b7 The parser')?.click();
		await settle();

		expect(opened).toEqual([{ note: PARSER }]);
		expect(composerThere()).toBe(false);
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

// The most valuable thing a chat can do with a good answer is let somebody
// keep it — docs/ARCHITECTURE.md § "Asking a tool to write the notes".
describe('keeping an answer', () => {
	/** An answer worth keeping, in a conversation that has named a place. */
	async function answered(said = 'The parser in `src/parser.ts` hands the lexer tokens.') {
		await saying('Write me a guide');
		stub.tell({ event: 'block', at: 0, block: { kind: 'said', said } });
		stub.tell({ event: 'ended' });
		await settle();
	}

	it('asks first, laying out what it would be called and where it would land', async () => {
		await answered();
		named('Keep as a note')?.click();
		await settle();

		expect(screen()).toContain('Place src/parser.ts');
		expect(named('Keep it')).toBeDefined();
		// Letting a whole reply through is an answer to the agent, and this is
		// the person's own act.
		expect(named('Allow the rest of this reply')).toBeUndefined();
		expect(acting.called).toEqual([]);
	});

	it('writes it through the act everything else the chat writes goes through', async () => {
		await answered();
		acting.answer = { said: '{}', told: 'Kept.', touched: [PARSER] };
		named('Keep as a note')?.click();
		await settle();
		named('Keep it')?.click();
		await settle();

		expect(acting.called.map((one) => one.act)).toEqual(['write_note']);
		expect(screen()).toContain('Kept.');
		expect(named('Keep as a note')).toBeUndefined();
	});

	it('says why it was not written and offers again, so the answer is not lost', async () => {
		await answered();
		acting.answer = {
			said: 'That note was not written.',
			trouble: true,
			told: 'That note was not written.'
		};
		named('Keep as a note')?.click();
		await settle();
		named('Keep it')?.click();
		await settle();

		expect(screen()).toContain('That note was not written.');
		expect(named('Keep as a note')).toBeDefined();

		acting.answer = { said: '{}', told: 'Kept.', touched: [PARSER] };
		named('Keep as a note')?.click();
		await settle();
		named('Keep it')?.click();
		await settle();

		expect(acting.called.map((one) => one.act)).toEqual(['write_note', 'write_note']);
		expect(screen()).toContain('Kept.');
		expect(screen()).not.toContain('That note was not written.');
	});

	it('writes nothing where the person turns it down, and offers again', async () => {
		await answered();
		named('Keep as a note')?.click();
		await settle();
		named('Don\u2019t')?.click();
		await settle();

		expect(acting.called).toEqual([]);
		expect(named('Keep as a note')).toBeDefined();
	});

	it('says what to do first where nothing in the chat has named a place', async () => {
		await answered('Nothing here names anywhere at all.');
		named('Keep as a note')?.click();
		await settle();

		expect(screen()).toContain('Ask about a file or a folder first');
		expect(named('Allow')).toBeUndefined();
	});

	it('offers it on one answer at a time, so there is no question of which', async () => {
		await answered();
		type('And the lexer?');
		labelled('Send')?.click();
		await settle();
		stub.tell({
			event: 'block',
			at: 0,
			block: { kind: 'said', said: 'The lexer in `src/lexer.ts` reads the characters.' }
		});
		stub.tell({ event: 'ended' });
		await settle();

		const keeps = () =>
			[...document.body.querySelectorAll('button')].filter(
				(one) => one.textContent?.trim() === 'Keep as a note'
			);
		expect(keeps()).toHaveLength(2);
		keeps()[1].click();
		await settle();

		expect(keeps().map((one) => one.disabled)).toEqual([true]);
		expect(screen()).toContain('Place src/lexer.ts');
	});

	// The person's own question is the one question left in the thread, and
	// nothing the agent does with its turn is an answer to it.
	it('stands until they answer it, whatever the agent does meanwhile', async () => {
		await answered();
		named('Keep as a note')?.click();
		await settle();

		type('And the lexer?');
		labelled('Send')?.click();
		await settle();
		acting.answer = { said: '{}' };
		await stub.serve({
			call: 'c9',
			act: 'write_note',
			arguments: { about: 'src/lexer.ts', sections: ['## The lexer\n\nIt reads characters.'] }
		} as ChatToolCall);
		stub.tell({ event: 'ended' });
		await settle();

		expect(named('Keep it')).toBeDefined();
		acting.answer = { said: '{}', told: 'Kept.', touched: [PARSER] };
		named('Keep it')?.click();
		await settle();

		expect(acting.called.map((one) => one.act)).toEqual(['write_note', 'write_note']);
		expect(screen()).toContain('Kept.');
	});
});

// DESIGN.md is mobile first, and so is this: one control, and on a phone it is
// the camera, the photo library or a file.
describe('putting a file in front of it', () => {
	function chose(...chosen: File[]): void {
		const picker = document.body.querySelector('input[type="file"]');
		if (!picker) throw new Error('nothing to attach with');
		Object.defineProperty(picker, 'files', { configurable: true, value: chosen });
		picker.dispatchEvent(new Event('change', { bubbles: true }));
	}

	async function open(): Promise<void> {
		await chat.opened(HOME);
		show();
		await settle();
	}

	it('shows what is attached and tells the agent where it was put', async () => {
		await open();
		chose(new File(['a picture'], 'the board.png', { type: 'image/png' }));
		await settle();

		expect(screen()).toContain('the board.png');

		type('What is this?');
		labelled('Send')?.click();
		await settle();

		expect(stub.said[0]).toContain('What is this?');
		expect(stub.said[0]).toContain('.sloppy/attached/');
		expect(await files.list('.sloppy/attached')).toHaveLength(1);
	});

	it('takes one back off, and off the project with it', async () => {
		await open();
		chose(new File(['a picture'], 'the board.png', { type: 'image/png' }));
		await settle();

		labelled('Take the board.png off')?.click();
		await settle();

		expect(screen()).not.toContain('the board.png');
		expect(await files.list('.sloppy/attached')).toEqual([]);
	});

	it('takes what was never said off the project when the conversation is let go', async () => {
		await open();
		type('What is in here?');
		labelled('Send')?.click();
		await settle();
		chose(new File(['a picture'], 'the board.png'));
		await settle();
		expect(await files.list('.sloppy/attached')).toHaveLength(1);

		named('Start again')?.click();
		await settle();

		expect(await files.list('.sloppy/attached')).toEqual([]);
	});

	it('says plainly that one is too big to send, and sends the rest', async () => {
		await open();
		const huge = new File(['x'], 'the film.mov');
		Object.defineProperty(huge, 'size', { value: CHAT_ATTACHMENT_MAX + 1 });
		chose(huge, new File(['a picture'], 'the board.png'));
		await settle();

		expect(screen()).toContain('too big to send');
		expect(screen()).toContain('the board.png');
		expect(await files.list('.sloppy/attached')).toHaveLength(1);
	});
});

describe('which model answers', () => {
	afterEach(() => prefs.set('chatModel', {}));

	it('is picked in the composer, remembered, and asked for when the chat starts', async () => {
		await chat.opened(HOME);
		show();
		await settle();
		expect(labelled('Answering with')?.textContent?.trim()).toBe('Claude Code');

		chat.setModel('sonnet');
		await settle();

		expect(labelled('Answering with')?.textContent?.trim()).toBe('Claude Code · Sonnet');
		expect(prefs.current.chatModel).toEqual({ claude_code: 'sonnet' });

		type('Write about the parser');
		labelled('Send')?.click();
		await settle();

		expect(stub.asked).toEqual([
			{
				agent: 'claude_code',
				model: 'sonnet',
				thread: { id: chat.current?.id, places: [] }
			}
		]);
	});

	it('leaves the chat in front of them with the one it started with, and says so', async () => {
		await chat.opened(HOME);
		chat.setModel('sonnet');
		await saying('What is in here?');

		chat.setModel('haiku');
		await settle();

		expect(screen()).toContain('This one is being answered with Sonnet.');
		expect(screen()).toContain('Start again to use Haiku.');
	});

	// Picking after a while is the commonest way round, and the one the notice
	// exists for: the composer reads the pick, and this says what the standing
	// conversation is still on.
	it('says so where the chat was started before anybody picked', async () => {
		await saying('What is in here?');

		chat.setModel('sonnet');
		await settle();

		expect(screen()).toContain('This one is being answered with its own choice.');
		expect(screen()).toContain('Start again to use Sonnet.');
	});
});

describe('starting again', () => {
	it('lets the conversation go, and says how to talk into the next one', async () => {
		await saying('What is in here?');
		expect(named('Start again')).toBeDefined();

		named('Start again')?.click();
		await settle();

		expect(stub.closes).toBe(1);
		expect(named('Start again')).toBeUndefined();
		expect(screen()).toContain('Say what you want written about');
	});

	it('says where dictation already is, rather than offering one of Sloppy\u2019s own', async () => {
		await chat.opened(HOME);
		show();
		await settle();

		expect(screen()).toContain('microphone on your keyboard');
		expect(labelled('Record')).toBeUndefined();
	});
});

describe('answering with', () => {
	it('reads the agent and the model picked, and offers every route this device reaches', async () => {
		stub.agent = ['claude_code', 'anthropic'];
		prefs.set('chatModel', { claude_code: 'fable' });
		await chat.opened(HOME);
		show();
		await settle();

		expect(labelled('Answering with')?.textContent?.trim()).toBe('Claude Code · Fable');
		expect(chat.agent).toBe('claude_code');
	});

	it('says what a turn spent, and the conversation so far, only where the agent says', async () => {
		await saying('What is in here?');
		expect(screen()).not.toContain('this turn');

		stub.tell({ event: 'ended', spent: { sent: 1200, answered: 340, cost: 0.04 } });
		await settle();
		expect(screen()).toContain('1.5k this turn · 1.5k in this chat · $0.04');

		type('And then?');
		labelled('Send')?.click();
		await settle();
		stub.tell({ event: 'ended', spent: { sent: 100, answered: 50, cost: 0.06 } });
		await settle();
		expect(screen()).toContain('150 this turn · 1.7k in this chat · $0.06');
	});

	it('moves the conversation to another agent, carrying what was said so far', async () => {
		stub.agent = ['claude_code', 'anthropic'];
		await saying('First question');
		stub.tell({ event: 'block', at: 0, block: { kind: 'said', said: 'An answer' } });
		stub.tell({ event: 'ended' });
		await settle();

		chat.pick('anthropic', undefined);
		await settle();
		expect(stub.closes).toBe(1);
		expect(chat.turns).toHaveLength(2);

		type('Second question');
		labelled('Send')?.click();
		await settle();
		expect(stub.asked.at(-1)?.agent).toBe('anthropic');
		const carried = stub.said.at(-1) ?? '';
		expect(carried).toContain('Earlier in this conversation');
		expect(carried).toContain('Person: First question');
		expect(carried).toContain('Assistant: An answer');
		expect(carried.endsWith('Second question')).toBe(true);
	});

	it('offers another agent where the session dies, and says the same thing to it', async () => {
		stub.agent = ['claude_code', 'anthropic'];
		await saying('Hello there');
		stub.tell({ event: 'block', at: 0, block: { kind: 'said', said: 'Hi' } });
		stub.tell({ event: 'over', said: 'It could not go on.' });
		await settle();

		expect(screen()).toContain('It could not go on.');
		named('Try with Anthropic')?.click();
		await settle();

		expect(stub.asked.at(-1)?.agent).toBe('anthropic');
		expect(stub.said.at(-1)).toBe('Hello there');
		expect(chat.turns.map((turn) => turn.from)).toEqual(['person']);
		expect(screen()).not.toContain('It could not go on.');
	});

	it('says a model the assistant does not know was refused, in words', async () => {
		prefs.set('chatModel', { claude_code: 'no-such-model' });
		await saying('Hello');
		stub.tell({ event: 'over', said: 'Error: model not found' });
		await settle();

		expect(screen()).toContain("That model isn't one this assistant knows. Pick another.");
		expect(screen()).not.toContain('model not found');
	});
});
