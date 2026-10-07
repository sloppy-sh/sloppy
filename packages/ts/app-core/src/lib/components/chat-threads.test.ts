// The chats a person keeps about one project: which one they are reading, and
// what can be done to it — DESIGN.md § Layout. The folder and the draft are
// both in memory; nothing here starts a program.

import 'fake-indexeddb/auto';
import { DeviceThreads, LocalApi, MemoryFiles, MemoryHistory } from '@sloppy/local';
import {
	draftBranch,
	ulid,
	type ChatAgent,
	type ChatEvent,
	type OwnedRef,
	type StandingDraft,
	type Ulid
} from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api, resetApi } from '../api.js';
import { type ChatAccess, type DraftAccess, initRuntime } from '../runtime.js';
import { seamSettledAgain } from '../seam.svelte.js';
import { chat } from '../stores/chat.svelte.js';
import { chatDraft } from '../stores/chat-draft.svelte.js';
import { nodes } from '../stores/nodes.svelte.js';
import { prefs } from '../stores/prefs.svelte.js';
import ChatPanel from './chat-panel.svelte';

const ROOT = '/Users/me/garden';
const COPY = '/appdata/drafts/one';

let store: Map<string, Uint8Array>;
let copyStore: Map<string, Uint8Array>;
let kept: MemoryHistory;
let standing: { draft: StandingDraft; history: MemoryHistory } | null;
/** What the clipboard was handed, where this device has one. */
let copied: string[];

const folder = () => new MemoryFiles({ root: ROOT, store, data: '/data' });
const copyFiles = () => new MemoryFiles({ root: COPY, store: copyStore, data: '/data' });
const inTheDraft = () => new LocalApi(copyFiles());

const drafts: DraftAccess = {
	standing: async () => (standing ? [standing.draft] : []),
	start: async (id) => {
		if (standing) {
			if (standing.draft.id !== id) throw new Error('a second draft for a second thread');
			return standing.draft;
		}
		copyStore = new Map();
		for (const [path, bytes] of store) {
			if (path.startsWith('/data/')) copyStore.set(path, bytes);
			else if (path.startsWith(`${ROOT}/`))
				copyStore.set(`${COPY}/${path.slice(ROOT.length + 1)}`, bytes);
		}
		const history = new MemoryHistory(copyFiles(), { author: 'Ada' });
		const began = await history.commit('The notes as the draft found them');
		if (!began) throw new Error('a copy of nothing');
		standing = {
			draft: { id, root: COPY, vault: COPY, branch: draftBranch(id), from: began.id },
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

let hear: ((event: ChatEvent) => void) | null;
let closes: number;

const chatting: ChatAccess = {
	agents: async () => ['claude_code'] as ChatAgent[],
	open: async (_asked, heard) => {
		hear = heard;
		return {
			say: async () => {},
			stop: async () => {},
			close: async () => {
				closes += 1;
				hear = null;
			}
		};
	},
	drafts
};

function stubViewport(): void {
	Object.defineProperty(globalThis, 'innerWidth', {
		configurable: true,
		writable: true,
		value: 390
	});
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: (query: string) => {
			const most = /max-width:\s*(\d+)px/.exec(query);
			return {
				matches: most ? 390 <= Number(most[1]) : false,
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

const labelled = (label: string): HTMLButtonElement | undefined =>
	[...document.body.querySelectorAll('button')].find(
		(one) => one.getAttribute('aria-label') === label
	);

const rows = (): string[] =>
	[...document.body.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')].map(
		(row) => row.textContent?.trim().replace(/\s+/g, ' ') ?? ''
	);

function row(label: string): HTMLElement {
	const found = [
		...document.body.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')
	].find((one) => (one.textContent?.trim().replace(/\s+/g, ' ') ?? '').startsWith(label));
	if (!found) throw new Error(`The menu does not offer "${label}"`);
	return found;
}

/** The one marked as the chat being read. */
const beingRead = (): string | undefined =>
	[...document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
		.find((one) => one.getAttribute('aria-checked') === 'true')
		?.textContent?.trim()
		.replace(/\s+/g, ' ');

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let graph: OwnedRef;

function show(): void {
	mounted = mount(ChatPanel, { target, props: { open: true, onOpen: () => {} } });
	flushSync();
}

/** A chat kept the way the device keeps one, so the panel opens on it. Its
 *  name came from the first thing said in it, so one is there. */
async function aThread(name: string, at: string): Promise<Ulid> {
	const id = ulid();
	await new DeviceThreads(folder()).write({
		id,
		name,
		graph,
		project: ROOT,
		created_at: at,
		updated_at: at,
		places: [],
		turns: [{ from: 'person', blocks: [{ kind: 'said', said: name }], at }]
	});
	return id;
}

/** A thread whose draft holds a note nobody has taken in. */
async function aThreadThatWrote(name: string, at: string): Promise<Ulid> {
	const id = await aThread(name, at);
	await chatDraft.start(id);
	await inTheDraft().createNode({ title: 'The parser' });
	await chatDraft.keepWhatTheTurnWrote();
	return id;
}

async function open(): Promise<void> {
	await chat.opened(graph);
	show();
	await settle();
}

async function switcher(): Promise<void> {
	labelled('Which thread')?.click();
	await settle();
}

async function aboutThisThread(): Promise<void> {
	labelled('More about this thread')?.click();
	await settle();
}

const head = () => labelled('Which thread')?.textContent?.trim();

beforeEach(async () => {
	store = new Map();
	copyStore = new Map();
	standing = null;
	hear = null;
	closes = 0;
	copied = [];
	kept = new MemoryHistory(folder(), { author: 'Ada' });
	chat.clear();
	chatDraft.clear();
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
		threads: new DeviceThreads(folder()),
		project: async () => folder()
	});
	seamSettledAgain();
	resetApi();
	await api.createNode({ title: 'Origins' });
	graph = await new LocalApi(folder()).graphHere();
	await kept.commit('A first version');

	Object.defineProperty(globalThis.navigator, 'clipboard', {
		configurable: true,
		value: {
			writeText: (text: string) => {
				copied.push(text);
				return Promise.resolve();
			}
		}
	});

	stubViewport();
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
	prefs.set('chatInBackground', false);
	chat.clear();
	chatDraft.clear();
	nodes.clear();
	standing = null;
	initRuntime({
		apiHost: () => '',
		mode: () => 'hosted',
		createApi: undefined,
		vault: undefined,
		history: () => undefined,
		chat: undefined,
		threads: undefined,
		project: undefined
	});
	seamSettledAgain();
	resetApi();
	target.remove();
	document.body.innerHTML = '';
});

describe('which thread is in front of somebody', () => {
	it('opens on the one written to most recently, and lists the rest under it', async () => {
		await aThread('About the parser', '2026-10-01T09:00:00.000Z');
		await aThread('About the vault', '2026-10-04T09:00:00.000Z');
		await open();

		expect(head()).toBe('About the vault');

		await switcher();

		expect(rows()).toEqual([
			'New thread',
			expect.stringContaining('About the vault'),
			expect.stringContaining('About the parser')
		]);
		expect(beingRead()).toContain('About the vault');
	});

	it('reads another one when it is chosen', async () => {
		await aThread('About the parser', '2026-10-01T09:00:00.000Z');
		await aThread('About the vault', '2026-10-04T09:00:00.000Z');
		await open();
		await switcher();

		row('About the parser').click();
		await settle();

		expect(head()).toBe('About the parser');
	});

	it('says quietly which one is still answering out of sight', async () => {
		prefs.set('chatInBackground', true);
		const parser = await aThread('About the parser', '2026-10-01T09:00:00.000Z');
		await aThread('About the vault', '2026-10-04T09:00:00.000Z');
		await open();
		await chat.say('What is in here?');
		await settle();

		await chat.openThread(parser);
		await settle();
		await switcher();

		expect(head()).toBe('About the parser');
		expect(rows().find((one) => one.includes('About the vault'))).toContain('answering');
		expect(rows().find((one) => one.includes('About the parser'))).not.toContain('answering');
		expect(
			document.body.querySelector('[aria-label="About the vault is still answering"]')
		).not.toBeNull();
	});

	it('refuses to swap one out from under an answer, in its own words', async () => {
		await aThread('About the parser', '2026-10-01T09:00:00.000Z');
		await aThread('About the vault', '2026-10-04T09:00:00.000Z');
		await open();
		await chat.say('What is in here?');
		await settle();
		await switcher();

		row('About the parser').click();
		await settle();

		expect(head()).toBe('About the vault');
		expect(screen()).toContain('The assistant is still answering. Stop it first.');
	});
});

describe('what can be done to the thread in front of somebody', () => {
	it('calls it something else, where its name was', async () => {
		await aThread('About the parser', '2026-10-01T09:00:00.000Z');
		await open();
		await aboutThisThread();
		row('Rename').click();
		await settle();

		const field = document.body.querySelector<HTMLInputElement>(
			'[aria-label="What this thread is called"]'
		);
		if (!field) throw new Error('nothing to rename it in');
		field.value = 'How the parser reads a note';
		field.dispatchEvent(new Event('input', { bubbles: true }));
		field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await settle();

		expect(head()).toBe('How the parser reads a note');
		expect((await new DeviceThreads(folder()).list())[0].name).toBe('How the parser reads a note');
	});

	it('puts one aside under its own heading, and takes it back from there', async () => {
		await aThread('About the parser', '2026-10-01T09:00:00.000Z');
		await open();
		await aboutThisThread();
		row('Archive').click();
		await settle();

		expect(head()).toBe('New thread');

		await switcher();
		expect(screen()).toContain('Archived');
		row('About the parser').click();
		await settle();
		await switcher();

		expect(beingRead()).toBeUndefined();
		expect(rows()).toEqual(['New thread', expect.stringContaining('About the parser')]);
		expect(screen()).not.toContain('Archived');
	});

	it('hands the whole chat over as something to keep', async () => {
		await aThread('About the parser', '2026-10-01T09:00:00.000Z');
		await open();
		await chat.say('And what does it do with a number?');
		hear?.({ event: 'block', at: 1, block: { kind: 'said', said: 'A parser reads a note.' } });
		hear?.({ event: 'ended' });
		await settle();

		await aboutThisThread();
		row('Copy the whole chat').click();
		await settle();

		expect(copied).toHaveLength(1);
		expect(copied[0]).toContain('# About the parser');
		expect(copied[0]).toContain('And what does it do with a number?');
		expect(copied[0]).toContain('A parser reads a note.');
		expect(screen()).toContain('Copied.');
	});

	it('says plainly where this device will not copy for it', async () => {
		Object.defineProperty(globalThis.navigator, 'clipboard', {
			configurable: true,
			value: undefined
		});
		await aThread('About the parser', '2026-10-01T09:00:00.000Z');
		await open();
		await aboutThisThread();
		row('Copy the whole chat').click();
		await settle();

		expect(screen()).toContain('Sloppy could not copy it here.');
	});
});

describe('deleting a thread', () => {
	it('asks once, and takes the chat with it', async () => {
		const id = await aThread('About the parser', '2026-10-01T09:00:00.000Z');
		await open();
		await aboutThisThread();
		row('Delete').click();
		await settle();

		expect(screen()).toContain('Delete this thread?');
		expect(named('Merge it, then delete')).toBeUndefined();
		expect(named('Keep it')).toBeDefined();

		named('Delete')?.click();
		await settle();

		expect(await new DeviceThreads(folder()).read(id)).toBeUndefined();
		expect(head()).toBe('New thread');
	});

	it('names what its draft holds, and offers the three ways out', async () => {
		await aThreadThatWrote('About the parser', '2026-10-01T09:00:00.000Z');
		await open();
		await aboutThisThread();
		row('Delete').click();
		await settle();

		expect(screen()).toContain('Its draft holds 1 new note.');
		expect(named('Merge it, then delete')).toBeDefined();
		expect(named('Delete it with the thread')).toBeDefined();
		expect(named('Keep the thread')).toBeDefined();
	});

	it('takes the draft into your own notes first, where that is the way chosen', async () => {
		const id = await aThreadThatWrote('About the parser', '2026-10-01T09:00:00.000Z');
		await open();
		await aboutThisThread();
		row('Delete').click();
		await settle();

		named('Merge it, then delete')?.click();
		await settle();

		const titles = (await new LocalApi(folder()).listNodes({})).map((note) => note.title);
		expect(titles).toContain('The parser');
		expect(await new DeviceThreads(folder()).read(id)).toBeUndefined();
		expect(standing).toBeNull();
	});

	it('throws the draft away with the thread where that is the way chosen', async () => {
		const id = await aThreadThatWrote('About the parser', '2026-10-01T09:00:00.000Z');
		await open();
		await aboutThisThread();
		row('Delete').click();
		await settle();

		named('Delete it with the thread')?.click();
		await settle();

		expect(await new DeviceThreads(folder()).read(id)).toBeUndefined();
		expect(standing).toBeNull();
	});

	it('leaves everything where it was where the thread is kept', async () => {
		const id = await aThreadThatWrote('About the parser', '2026-10-01T09:00:00.000Z');
		await open();
		await aboutThisThread();
		row('Delete').click();
		await settle();

		named('Keep the thread')?.click();
		await settle();

		expect(await new DeviceThreads(folder()).read(id)).toBeDefined();
		expect(standing).not.toBeNull();
		expect(closes).toBe(0);
	});
});
