// Reading a draft where the chat is, and taking it in with one act —
// DESIGN.md § "Reading a draft". The folder and the draft are both in memory;
// nothing here starts a program.

import 'fake-indexeddb/auto';
import { LocalApi, MemoryFiles, MemoryHistory } from '@sloppy/local';
import {
	draftBranch,
	ulid,
	type BlockDocument,
	type ChatAgent,
	type ChatEvent,
	type OwnedRef,
	type StandingDraft
} from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api, resetApi } from '../api.js';
import type { DraftOnTheCanvas } from '../draft-said.js';
import { initRuntime, type ChatAccess, type DraftAccess } from '../runtime.js';
import { seamSettledAgain } from '../seam.svelte.js';
import { chat } from '../stores/chat.svelte.js';
import { chatDraft } from '../stores/chat-draft.svelte.js';
import { nodes } from '../stores/nodes.svelte.js';
import ChatPanel from './chat-panel.svelte';

const ROOT = '/Users/me/garden';
const COPY = '/appdata/drafts/one';

let store: Map<string, Uint8Array>;
let copyStore: Map<string, Uint8Array>;
let kept: MemoryHistory;
let standing: { draft: StandingDraft; history: MemoryHistory } | null;

const folder = () => new MemoryFiles({ root: ROOT, store, data: '/data' });
const copyFiles = () => new MemoryFiles({ root: COPY, store: copyStore, data: '/data' });
const inTheDraft = () => new LocalApi(copyFiles());

function words(said: string): BlockDocument {
	return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: said }] }] };
}

const drafts: DraftAccess = {
	standing: async () => standing?.draft,
	start: async () => {
		if (standing) return standing.draft;
		const tip = await kept.currentCommit();
		const from = tip === undefined ? new Map<string, Uint8Array>() : await kept.readAt(tip);
		copyStore = new Map();
		for (const [path, bytes] of store) {
			if (path.startsWith('/data/')) copyStore.set(path, bytes);
		}
		for (const [path, bytes] of from) copyStore.set(`${COPY}/${path}`, bytes);
		const history = new MemoryHistory(copyFiles(), { author: 'Ada' });
		const forked = await history.commit('The version it was taken from');
		if (!forked) throw new Error('a copy of nothing');
		const id = ulid();
		standing = {
			draft: { id, root: COPY, vault: COPY, branch: draftBranch(id), from: forked.id },
			history
		};
		return standing.draft;
	},
	discard: async () => {
		standing = null;
		copyStore = new Map();
	},
	files: () => copyFiles(),
	history: () => {
		if (!standing) throw new Error('no draft');
		return standing.history;
	}
};

/** How many sessions have been opened and how many let go: a session runs
 *  where the draft is, so the two have to stay in step with it. */
let sessions: { opened: number; closed: number };
let hear: ((event: ChatEvent) => void) | null;

const chatting: ChatAccess = {
	agents: async () => ['claude_code'] as ChatAgent[],
	open: async (_asked, heard) => {
		sessions.opened += 1;
		hear = heard;
	},
	say: async () => {},
	settle: async () => {},
	stop: async () => {},
	close: async () => {
		sessions.closed += 1;
		hear = null;
	},
	drafts
};

/** A phone, which is where the review is the whole panel. */
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

const named = (label: string): HTMLButtonElement | undefined =>
	[...document.body.querySelectorAll('button')].find((one) => one.textContent?.trim() === label);

const card = (heading: string): HTMLButtonElement | undefined =>
	[...document.body.querySelectorAll('button')].find((one) => one.textContent?.includes(heading));

const labelled = (label: string): HTMLButtonElement | undefined =>
	[...document.body.querySelectorAll('button')].find(
		(one) => one.getAttribute('aria-label') === label
	);

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let graph: OwnedRef;
let origins: OwnedRef;
let seed: OwnedRef;
/** What the page was handed to draw on the canvas, newest last. */
let drawn: (DraftOnTheCanvas | null)[];

function show(): void {
	mounted = mount(ChatPanel, {
		target,
		props: { open: true, onOpen: () => {}, onShowDraft: (shown) => drawn.push(shown) }
	});
	flushSync();
}

/** What somebody types and sends, which is a turn. */
async function say(words: string): Promise<void> {
	const into = document.body.querySelector<HTMLTextAreaElement>(
		'[aria-label="What you want written about"]'
	);
	if (!into) throw new Error('no composer');
	into.value = words;
	into.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
	labelled('Send')?.click();
	await settle();
}

/** One turn of the chat, which is the draft where none stands, what it wrote,
 *  and the version kept on the draft when the turn ends. */
async function aTurn(wrote: (drafted: LocalApi) => Promise<void>): Promise<void> {
	await chatDraft.start();
	await wrote(inTheDraft());
	await chatDraft.keepWhatTheTurnWrote();
}

/** The same, driven through the panel, so a session stands around it. */
async function aTurnInTheChat(wrote: (drafted: LocalApi) => Promise<void>): Promise<void> {
	await say('Write about the parser');
	await wrote(inTheDraft());
	hear?.({ event: 'ended' });
	await settle();
}

beforeEach(async () => {
	store = new Map();
	copyStore = new Map();
	standing = null;
	sessions = { opened: 0, closed: 0 };
	hear = null;
	drawn = [];
	kept = new MemoryHistory(folder(), { author: 'Ada' });
	chat.clear();
	nodes.clear();
	initRuntime({
		apiHost: () => '',
		mode: () => 'local',
		createApi: () => new LocalApi(folder()),
		vault: {
			folder: () => ROOT,
			graph: () => new LocalApi(folder()).graphHere(),
			asks: true,
			open: async () => ROOT
		},
		history: () => kept,
		chat: chatting,
		project: async () => folder()
	});
	seamSettledAgain();
	resetApi();
	const note = await api.createNode({ title: 'Origins' });
	origins = note.ref;
	seed = (await api.createBlock({ node: origins, content: words('The seed') })).ref;
	graph = await new LocalApi(folder()).graphHere();
	await kept.commit('A first version');

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
	standing = null;
	initRuntime({
		apiHost: () => '',
		mode: () => 'hosted',
		createApi: undefined,
		vault: undefined,
		history: () => undefined,
		chat: undefined,
		project: undefined
	});
	seamSettledAgain();
	resetApi();
	target.remove();
	document.body.innerHTML = '';
});

describe('where a chat begins', () => {
	it('says once that it works in a draft from the version last kept', async () => {
		await chat.opened(graph);
		show();
		await settle();

		expect(screen()).toContain(
			'It works in a draft of your notes, from the version you last kept.'
		);
		expect(screen()).not.toContain('Nothing is written until you say so.');
		expect(named('Review')).toBeUndefined();
	});
});

describe('the line a standing draft is said on', () => {
	it('says how much is in it, and offers reading it or throwing it away', async () => {
		await aTurn(async (drafted) => {
			await drafted.createNode({ title: 'The parser' });
			await drafted.updateNode(origins, { title: 'Where it began' });
		});
		await chat.opened(graph);
		show();
		await settle();

		expect(screen()).toContain('A draft is standing — 1 new note, 1 renamed.');
		expect(named('Review')).toBeDefined();
		expect(named('Discard')).toBeDefined();
		expect(screen()).toContain('Discarding keeps nothing the chat wrote.');
	});

	it('is not there at all before anything has written into one', async () => {
		await chat.opened(graph);
		show();
		await settle();

		expect(screen()).not.toContain('A draft is standing');
	});

	it('throws it away from where it is said, leaving the folder as it was', async () => {
		await aTurn(async (drafted) => {
			await drafted.createNode({ title: 'The parser' });
		});
		await chat.opened(graph);
		show();
		await settle();

		named('Discard')?.click();
		await settle();

		expect(screen()).not.toContain('A draft is standing');
		expect((await api.listNodes({ graph })).map((one) => one.title)).toEqual(['Origins']);
	});
});

describe('the session the draft was written in', () => {
	/** The agent ran inside the draft, so the session cannot outlive it: the
	 *  next turn opens another, in another draft. */
	async function thenSaySomethingElse(): Promise<void> {
		expect(sessions).toEqual({ opened: 1, closed: 1 });

		await say('And the vault?');

		expect(sessions).toEqual({ opened: 2, closed: 1 });
		expect(chatDraft.standing).not.toBe(null);
	}

	it('is let go when the draft is taken in, and another opens for the next turn', async () => {
		await chat.opened(graph);
		show();
		await settle();
		await aTurnInTheChat(async (drafted) => {
			await drafted.createNode({ title: 'The parser' });
		});

		named('Review')?.click();
		await settle();
		named('Merge')?.click();
		await settle();

		await thenSaySomethingElse();
	});

	it('is let go when the draft is thrown away from the line it is said on', async () => {
		await chat.opened(graph);
		show();
		await settle();
		await aTurnInTheChat(async (drafted) => {
			await drafted.createNode({ title: 'The parser' });
		});

		named('Discard')?.click();
		await settle();

		await thenSaySomethingElse();
	});
});

describe('the review', () => {
	async function reading(): Promise<void> {
		await chat.opened(graph);
		show();
		await settle();
		named('Review')?.click();
		await settle();
	}

	it('lists what the draft did, in bands, and opens a note as the draft has it', async () => {
		await aTurn(async (drafted) => {
			await drafted.createNode({ title: 'The parser' });
			await drafted.updateBlock(seed, { content: words('The seed of it all') });
		});
		await reading();

		expect(screen()).toContain('The draft');
		expect(screen()).toContain('New');
		expect(screen()).toContain('The parser');
		expect(screen()).toContain('Written into');
		expect(screen()).toContain('Origins');

		card('Origins')?.click();
		await settle();

		expect(screen()).toContain('The seed of it all');
		expect(named('In the draft')).toBeDefined();
	});

	it('reads a row on the reading surface, with the folder\u2019s copy one tap away', async () => {
		await aTurn(async (drafted) => {
			await drafted.updateBlock(seed, { content: words('The seed of it all') });
		});
		await reading();

		card('Origins')?.click();
		await settle();

		expect(screen()).toContain('The seed of it all');
		expect(screen()).toContain('Written into by the chat');

		named('In your folder')?.click();
		await settle();

		expect(screen()).toContain('The seed');
		expect(screen()).not.toContain('The seed of it all');
		expect(screen()).not.toContain('Written into by the chat');
	});

	it('takes the whole draft in with one act, and the draft is gone', async () => {
		await aTurn(async (drafted) => {
			await drafted.createNode({ title: 'The parser' });
		});
		await reading();

		named('Merge')?.click();
		await settle();

		expect((await api.listNodes({ graph })).map((one) => one.title).sort()).toEqual([
			'Origins',
			'The parser'
		]);
		expect(chatDraft.standing).toBe(null);
		expect(screen()).toContain('Say what you want written about');
	});

	it('hands a note both sides wrote in to the person, and holds the merge until it is settled', async () => {
		await aTurn(async (drafted) => {
			await drafted.updateBlock(seed, { content: words('As the chat has it') });
		});
		await api.updateBlock(seed, { content: words('As I have it') });
		await reading();

		expect(screen()).toContain('To settle first');
		expect(screen()).toContain('One note is still to settle.');
		expect(named('Merge')?.disabled).toBe(true);

		named("Take the draft's")?.click();
		await settle();

		expect(named('Merge')?.disabled).toBe(false);
		named('Merge')?.click();
		await settle();

		expect((await api.listBlocks(origins)).map((one) => JSON.stringify(one.content))).toEqual([
			JSON.stringify(words('As the chat has it'))
		]);
	});

	it('draws the two states on the canvas while it is up, and the graph as it stands after', async () => {
		let parser: OwnedRef;
		await aTurn(async (drafted) => {
			parser = (await drafted.createNode({ title: 'The parser' })).ref;
			await drafted.updateBlock(seed, { content: words('The seed of it all') });
		});
		await reading();

		const shown = drawn.at(-1);
		expect(shown?.says).toBe('Your notes to the draft');
		expect([...(shown?.difference.added ?? [])]).toEqual([parser!]);
		expect([...(shown?.difference.changed ?? [])]).toEqual([origins]);

		labelled('Back to the chat')?.click();
		await settle();

		expect(drawn.at(-1)).toBe(null);
	});

	it('says so in one line where nothing in it is different, and offers only throwing it away', async () => {
		await chatDraft.start();
		await reading();

		expect(screen()).toContain('Nothing in your notes is different, so there is nothing to merge.');
		expect(named('Merge')).toBeUndefined();
		expect(named('Discard')).toBeDefined();
	});
});

describe('while the chat is still writing', () => {
	it('leaves the draft alone until the turn has ended', async () => {
		await aTurn(async (drafted) => {
			await drafted.createNode({ title: 'The parser' });
		});
		await chat.opened(graph);
		show();
		await settle();
		await say('And the vault?');

		expect(screen()).toContain('The chat is still writing into it.');
		expect(named('Review')?.disabled).toBe(true);
		expect(named('Discard')?.disabled).toBe(true);
	});
});
