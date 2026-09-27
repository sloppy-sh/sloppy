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
	type OwnedRef,
	type StandingDraft
} from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api, resetApi } from '../api.js';
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

const chatting: ChatAccess = {
	agents: async () => ['claude_code'] as ChatAgent[],
	open: async () => {},
	say: async () => {},
	settle: async () => {},
	stop: async () => {},
	close: async () => {},
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

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let graph: OwnedRef;
let origins: OwnedRef;
let seed: OwnedRef;

function show(): void {
	mounted = mount(ChatPanel, { target, props: { open: true, onOpen: () => {} } });
	flushSync();
}

/** One turn of the chat, which is the draft where none stands, what it wrote,
 *  and the version kept on the draft when the turn ends. */
async function aTurn(wrote: (drafted: LocalApi) => Promise<void>): Promise<void> {
	await chatDraft.start();
	await wrote(inTheDraft());
	await chatDraft.keepWhatTheTurnWrote();
}

beforeEach(async () => {
	store = new Map();
	copyStore = new Map();
	standing = null;
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

		expect(screen()).toContain('As the draft has it.');
		expect(screen()).toContain('The seed of it all');
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
		const into = document.body.querySelector<HTMLTextAreaElement>(
			'[aria-label="What you want written about"]'
		);
		if (!into) throw new Error('no composer');
		into.value = 'And the vault?';
		into.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		[...document.body.querySelectorAll('button')]
			.find((one) => one.getAttribute('aria-label') === 'Send')
			?.click();
		await settle();

		expect(screen()).toContain('The chat is still writing into it.');
		expect(named('Review')?.disabled).toBe(true);
		expect(named('Discard')?.disabled).toBe(true);
	});
});
