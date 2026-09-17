// Two folders on one device holding one graph, on the surface that lists them
// and over the client that serves them — docs/ARCHITECTURE.md § "Local-only
// mode". The rows are folders, told apart by their root, and the folder that is
// open is the one the canvas reads and the one marked here.

import { LocalApi, MemoryFiles } from '@sloppy/local';
import type { OwnedRef } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetApi } from '../api.js';
import { initRuntime, type KnownFolder, type VaultAccess } from '../runtime.js';
import { graphs } from '../stores/graphs.svelte.js';
import { nodes } from '../stores/nodes.svelte.js';
import { peers } from '../stores/peers.svelte.js';
import { people } from '../stores/people.svelte.js';
import { prefs } from '../stores/prefs.svelte.js';
import { session } from '../stores/session.svelte.js';
import { tags } from '../stores/tags.svelte.js';
import { at, pushed, replaced, startAt } from './page.test-support.svelte.js';

vi.mock('$app/state', () => ({
	page: {
		get url() {
			return new URL(at.path, 'http://app.test');
		},
		get state() {
			return at.note ? { note: at.note, notes: at.notes } : {};
		}
	}
}));

vi.mock('$app/navigation', () => ({
	pushState: (path: string, state: { note?: OwnedRef; notes?: readonly OwnedRef[] }) =>
		pushed(path, state.note ?? null, [...(state.notes ?? [])]),
	replaceState: (path: string, state: { note?: OwnedRef; notes?: readonly OwnedRef[] }) =>
		replaced(path, state.note ?? null, [...(state.notes ?? [])]),
	afterNavigate: () => {}
}));

vi.mock('@sloppy/ui', async (original) => ({
	...((await original()) as object),
	GraphSurface: (await import('./graph-surface.test-support.svelte')).default
}));

const Graph = (await import('./graph.svelte')).default;

const GARDEN = '/Users/me/garden';
const COPY = '/Users/me/garden-from-elsewhere';

let store: Map<string, Uint8Array>;
let open: string;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

/** The folder as a client of its own reaches it, which is how a shell serves
 *  whichever one is open. */
function client(root: string): LocalApi {
	return new LocalApi(new MemoryFiles({ root, store, data: '/data' }));
}

/** What a shell reads out of a folder to list it, as the native one does: the
 *  graph in that folder's own `graph.json` and nothing from any other. */
function folderRow(root: string): KnownFolder {
	const bytes = store.get(`${root}/graph.json`);
	if (!bytes) return { root, reachable: false };
	const said = JSON.parse(new TextDecoder().decode(bytes)) as {
		owner: string;
		graph: string;
		name: string;
	};
	return {
		root,
		graph: { ref: `${said.owner}/${said.graph}` as OwnedRef, name: said.name, owner: said.owner },
		reachable: true
	};
}

function vault(api: LocalApi): VaultAccess {
	return {
		folder: () => open,
		graph: () => api.graphHere(),
		asks: true,
		open: async () => open,
		known: async () => [GARDEN, COPY].map(folderRow),
		openKnown: async (root) => {
			open = root;
		},
		forget: async () => {}
	};
}

/** Serve the app off the folder that is open, as a shell with that folder
 *  chosen does, holding nothing of the last reader. */
async function serving(root: string): Promise<void> {
	open = root;
	const api = client(root);
	initRuntime({
		apiHost: () => '',
		mode: () => 'local',
		createApi: () => api,
		vault: vault(api)
	});
	resetApi();
	nodes.clear();
	tags.clear();
	graphs.clear();
	peers.clear();
	people.hold(null);
	session.clear();
	await session.refresh();
	await people.read().catch(() => undefined);
}

function stubViewport(): void {
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: (query: string) => ({
			matches: query.includes('max-width'),
			addEventListener: () => {},
			removeEventListener: () => {}
		})
	});
	Object.defineProperty(globalThis, 'ResizeObserver', {
		configurable: true,
		writable: true,
		value: class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	});
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 40; turn += 1) {
		await new Promise((wake) => setTimeout(wake));
		flushSync();
	}
}

async function openGraph(): Promise<void> {
	mounted = mount(Graph, { target });
	flushSync();
	await settle();
}

async function openGraphs(): Promise<void> {
	const found = [...document.body.querySelectorAll('button')].find(
		(one) => one.getAttribute('aria-label') === 'Your graphs'
	);
	if (!found) throw new Error('There is nowhere to choose a graph');
	found.click();
	await settle();
}

/** Every row the picker lists, as somebody reads it: what it says, whether it
 *  is marked as the one they are in, and whether it offers to be forgotten. */
function rows(): { says: string; here: boolean; forgettable: boolean }[] {
	const sheet = [...document.body.querySelectorAll<HTMLElement>('[role="dialog"]')].find(
		(surface) => surface.dataset.state !== 'closed'
	);
	if (!sheet) throw new Error('No surface is up over the graph');
	return [...sheet.querySelectorAll('li')].map((row) => {
		const choose = row.querySelector('button');
		return {
			says: (choose?.textContent ?? '').replace(/\s+/g, ' ').trim(),
			here: choose?.getAttribute('aria-current') === 'true',
			forgettable: [...row.querySelectorAll('button')].some((one) =>
				one.getAttribute('aria-label')?.startsWith('Forget')
			)
		};
	});
}

/** The addresses the canvas has been handed. */
const drawn = (): string[] =>
	[...document.body.querySelectorAll<HTMLElement>('[aria-label="The graph"] [data-expand]')].map(
		(mark) => mark.dataset.expand ?? ''
	);

beforeEach(async () => {
	startAt('/');
	stubViewport();
	localStorage.clear();
	prefs.init();
	store = new Map();

	// The original, and then a copy of it brought onto the same device beside
	// it: one graph ulid in two folders, each free to be named its own thing.
	const first = client(GARDEN);
	await first.createNode({ title: 'Origins' });
	await first.updateGraph(await first.graphHere(), { title: 'The garden' });
	for (const [path, bytes] of [...store]) {
		if (!path.startsWith(`${GARDEN}/`)) continue;
		store.set(path.replace(`${GARDEN}/`, `${COPY}/`), bytes);
	}
	const second = client(COPY);
	await second.updateGraph(await second.graphHere(), { title: 'The garden as it was sent' });
	await second.createNode({ title: 'Read here first' });

	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	document.body.innerHTML = '';
	initRuntime({ apiHost: () => '', vault: undefined });
	resetApi();
	graphs.clear();
	session.clear();
});

describe('two folders holding one graph', () => {
	it('are two rows, each named by the graph in it, with the open one marked here', async () => {
		await serving(COPY);
		await openGraph();
		await openGraphs();

		expect(rows()).toEqual([
			{ says: 'The garden garden', here: false, forgettable: true },
			{
				says: 'The garden as it was sent garden-from-elsewhere',
				here: true,
				forgettable: false
			}
		]);
	});

	it('draw the notes of the folder that is open, whichever was written down first', async () => {
		await serving(COPY);
		await openGraph();

		expect(drawn().length).toBe(2);
		expect(document.body.textContent).toContain('Read here first');
	});

	it('mark the other one here when it is the one open, on the same rows', async () => {
		await serving(GARDEN);
		await openGraph();
		await openGraphs();

		expect(rows().map((row) => row.here)).toEqual([true, false]);
		expect(rows().map((row) => row.forgettable)).toEqual([false, true]);
	});
});
