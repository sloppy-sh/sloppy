// The folders a thread reads besides its own project — DESIGN.md § Layout.
// Nothing here starts a program, and no folder is opened off the disk.

import 'fake-indexeddb/auto';
import { DeviceThreads, type Files, LocalApi, MemoryFiles } from '@sloppy/local';
import type { ChatAgent, ChatEvent, OwnedRef } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetApi } from '../api.js';
import { type ChatAccess, initRuntime, type KnownFolder } from '../runtime.js';
import { seamSettledAgain } from '../seam.svelte.js';
import { chat } from '../stores/chat.svelte.js';
import { graphs } from '../stores/graphs.svelte.js';
import { nodes } from '../stores/nodes.svelte.js';
import ChatPanel from './chat-panel.svelte';

const ROOT = '/Users/me/garden';
const BESIDE = '/Users/me/work/parser';
const NAMED = '/Users/me/work/almanac';
const THESIS = '/Users/me/work/thesis';

let store: Map<string, Uint8Array>;
const folder = () => new MemoryFiles({ root: ROOT, store, data: '/data' });

/** The folders this device would let a chat read, by root. */
let admits: Map<string, Files>;
/** The folders it lists, and what the picker answers with. */
let known: KnownFolder[];
let picked: KnownFolder | undefined;
/** The folder this device serves. Opening one moves it; admitting a place to
 *  read must not. */
let served: string;

let hear: ((event: ChatEvent) => void) | null;

const chatting: ChatAccess = {
	agents: async () => ['claude_code'] as ChatAgent[],
	open: async (_asked, heard) => {
		hear = heard;
	},
	say: async () => {},
	stop: async () => {},
	close: async () => {}
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

const offered = (): string[] =>
	[...document.body.querySelectorAll('[role="menuitem"]')].map(
		(row) => row.textContent?.trim().replace(/\s+/g, ' ') ?? ''
	);

function item(label: string): HTMLElement {
	const found = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((row) =>
		(row.textContent?.trim().replace(/\s+/g, ' ') ?? '').startsWith(label)
	);
	if (!found) throw new Error(`The menu does not offer "${label}"`);
	return found;
}

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let graph: OwnedRef;

function show(): void {
	mounted = mount(ChatPanel, { target, props: { open: true, onOpen: () => {} } });
	flushSync();
}

/** The chat open on the project, with the folders this device knows read. */
async function open(): Promise<void> {
	await graphs.readFolders(true);
	await chat.opened(graph);
	show();
	await settle();
}

/** Say something and have it answered, so the chat is a thread with a project
 *  of its own and nothing is underway. */
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
	hear?.({ event: 'ended' });
	await settle();
}

/** Open the list of folders a place can be added from. */
async function alsoReadFrom(): Promise<void> {
	const open = named('Also read from…');
	if (!open) throw new Error('no way to add a place');
	open.click();
	await settle();
}

beforeEach(async () => {
	store = new Map();
	hear = null;
	picked = undefined;
	served = ROOT;
	admits = new Map([
		[BESIDE, new MemoryFiles({ root: BESIDE, store: new Map(), data: '/data' })],
		[NAMED, new MemoryFiles({ root: NAMED, store: new Map(), data: '/data' })]
	]);
	chat.clear();
	nodes.clear();
	graphs.clear();
	initRuntime({
		apiHost: () => '',
		mode: () => 'local',
		createApi: () => new LocalApi(folder()),
		vault: {
			folder: () => served,
			graph: () => new LocalApi(folder()).graphHere(),
			asks: true,
			open: async () => served,
			known: async () => known,
			openProject: async () => {
				served = NAMED;
				return NAMED;
			}
		},
		chat: chatting,
		threads: new DeviceThreads(folder()),
		project: async () => folder(),
		placeFiles: (root: string) => admits.get(root),
		askPlace: async () => picked
	});
	seamSettledAgain();
	resetApi();
	graph = await new LocalApi(folder()).graphHere();
	known = [
		{
			root: ROOT,
			graph: { ref: graph, name: 'The garden', owner: 'did:syr:me', project: ROOT },
			reachable: true
		},
		{
			root: BESIDE,
			graph: {
				ref: 'did:syr:me/01HZZZZZZZZZZZZZZZZZZZZZZZ' as OwnedRef,
				name: 'Parser notes',
				owner: 'did:syr:me',
				project: BESIDE
			},
			reachable: true
		},
		{
			root: THESIS,
			graph: {
				ref: 'did:syr:me/01HZZZZZZZZZZZZZZZZZZZZZZY' as OwnedRef,
				name: 'The thesis',
				owner: 'did:syr:me'
			},
			reachable: true
		},
		{ root: '/Users/me/moved', reachable: false }
	];

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
	chat.clear();
	nodes.clear();
	graphs.clear();
	initRuntime({
		apiHost: () => '',
		mode: () => 'hosted',
		createApi: undefined,
		vault: undefined,
		chat: undefined,
		threads: undefined,
		project: undefined,
		placeFiles: undefined,
		askPlace: undefined
	});
	seamSettledAgain();
	resetApi();
	target.remove();
	document.body.innerHTML = '';
});

describe('the folders a thread also reads', () => {
	it('offers the ones this device knows, by what they are called, and never its own', async () => {
		await open();
		await say('What is in here?');
		await alsoReadFrom();

		expect(offered()).toContain('parser /Users/me/work/parser');
		expect(offered()).toContain('The thesis /Users/me/work/thesis');
		expect(offered().some((row) => row.includes(ROOT))).toBe(false);
		expect(offered().some((row) => row.includes('/Users/me/moved'))).toBe(false);
	});

	it('adds one, and shows it by its name alone', async () => {
		await open();
		await say('What is in here?');
		await alsoReadFrom();
		item('parser').click();
		await settle();

		expect(chat.places).toEqual([{ root: BESIDE, name: 'parser', graph: known[1].graph?.ref }]);
		expect(screen()).toContain('parser');
		expect(screen()).not.toContain(BESIDE);
	});

	it('adds a folder somebody names, which this device had not been told about', async () => {
		picked = { root: NAMED, reachable: true };
		await open();
		await say('What is in here?');
		await alsoReadFrom();
		item('Another folder…').click();
		await settle();

		expect(chat.places).toEqual([{ root: NAMED, name: 'almanac' }]);
	});

	it('leaves the folder it was given as it found it, and the graph where it was', async () => {
		picked = {
			root: NAMED,
			graph: {
				ref: 'did:syr:me/01HZZZZZZZZZZZZZZZZZZZZZZX' as OwnedRef,
				name: 'The almanac',
				owner: 'did:syr:me'
			},
			reachable: true
		};
		await open();
		await say('What is in here?');
		await alsoReadFrom();
		item('Another folder…').click();
		await settle();

		// The notes it already holds are what a place is read through, so the
		// graph comes with it rather than being started there.
		expect(chat.places).toEqual([{ root: NAMED, name: 'The almanac', graph: picked.graph?.ref }]);
		expect(served).toBe(ROOT);
		expect(chat.current?.project).toBe(ROOT);
	});

	it('offers no folder of its own to name where this device cannot ask for one', async () => {
		picked = undefined;
		initRuntime({
			apiHost: () => '',
			mode: () => 'local',
			createApi: () => new LocalApi(folder()),
			vault: {
				folder: () => served,
				graph: () => new LocalApi(folder()).graphHere(),
				asks: true,
				open: async () => served,
				known: async () => known
			},
			chat: chatting,
			threads: new DeviceThreads(folder()),
			project: async () => folder(),
			placeFiles: (root: string) => admits.get(root),
			askPlace: undefined
		});
		seamSettledAgain();
		await open();
		await say('What is in here?');
		await alsoReadFrom();

		expect(offered().some((row) => row.startsWith('Another folder'))).toBe(false);
		expect(offered()).toContain('parser /Users/me/work/parser');
	});

	it('takes one back off', async () => {
		await open();
		await say('What is in here?');
		await alsoReadFrom();
		item('parser').click();
		await settle();

		labelled('Stop reading parser')?.click();
		await settle();

		expect(chat.places).toEqual([]);
	});

	it('says the conversation picks the new ones up when it next hears something', async () => {
		await open();
		await say('What is in here?');
		hear?.({ event: 'started', session: '3f1a0c2e-0000-4000-8000-000000000001', tools: [] });
		await settle();
		await alsoReadFrom();
		item('parser').click();
		await settle();

		expect(screen()).toContain('The next thing you say starts the assistant again');
	});

	it('is nowhere at all on a device that reads no folder but the one it is in', async () => {
		initRuntime({
			apiHost: () => '',
			mode: () => 'local',
			createApi: () => new LocalApi(folder()),
			vault: { folder: () => ROOT, graph: async () => graph, asks: true, open: async () => ROOT },
			chat: chatting,
			threads: new DeviceThreads(folder()),
			project: async () => folder(),
			placeFiles: undefined,
			askPlace: undefined
		});
		seamSettledAgain();
		await open();
		await say('What is in here?');

		expect(named('Also read from…')).toBeUndefined();
	});
});
