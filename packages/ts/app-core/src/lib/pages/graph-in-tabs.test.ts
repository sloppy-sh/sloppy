// Switching the folder in front of the reader, on the page that reads one —
// docs/ARCHITECTURE.md § "Several folders open at once". A switch is the folder
// switch this page has always done, plus the memory of how each folder was
// being read: the folder being left is snapshotted, the one arrived at is
// brought back as it was, and a folder nobody has read here starts clean.

import { LocalApi, MemoryFiles } from '@sloppy/local';
import type { OwnedRef, Tag } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetApi } from '../api.js';
import { initRuntime, type KnownFolder, type VaultAccess } from '../runtime.js';
import { graphs } from '../stores/graphs.svelte.js';
import { nodes } from '../stores/nodes.svelte.js';
import { peers } from '../stores/peers.svelte.js';
import { people } from '../stores/people.svelte.js';
import { type FolderView, prefs } from '../stores/prefs.svelte.js';
import { session } from '../stores/session.svelte.js';
import { tabs } from '../stores/tabs.svelte.js';
import { tags } from '../stores/tags.svelte.js';
import { at, pushed, replaced, startAt } from './page.test-support.svelte.js';
import { field, forgetTheField } from './graph-in-tabs.test-support.svelte';

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
	GraphSurface: (await import('./graph-in-tabs.test-support.svelte')).default
}));

const Graph = (await import('./graph.svelte')).default;

const THESIS = '/Users/me/thesis';
const GARDEN = '/Users/me/garden';

let store: Map<string, Uint8Array>;
let open: string;
let clients: Map<string, LocalApi>;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

function client(root: string): LocalApi {
	const held = clients.get(root);
	if (held) return held;
	const made = new LocalApi(new MemoryFiles({ root, store, data: '/data' }));
	clients.set(root, made);
	return made;
}

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

const graphIn = (root: string): OwnedRef => folderRow(root).graph!.ref;

/** The shell serving whichever folder is open, which is what a switch moves. */
const vault = (): VaultAccess => ({
	folder: () => open,
	graph: () => client(open).graphHere(),
	asks: true,
	open: async () => open,
	known: async () => [THESIS, GARDEN].map(folderRow),
	openKnown: async (root) => {
		open = root;
	},
	forget: async () => {}
});

async function serving(root: string): Promise<void> {
	open = root;
	initRuntime({
		apiHost: () => '',
		mode: () => 'local',
		createApi: () => client(open),
		vault: vault()
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
	// A page listens on the window for as long as it is mounted, so a suite that
	// opens the graph twice would be answered by both of them.
	if (mounted) unmount(mounted, { outro: false });
	mounted = mount(Graph, { target });
	flushSync();
	await settle();
}

async function switchTo(root: string): Promise<void> {
	await tabs.switchTo(root);
	await settle();
}

/** The canvas, as the page has it drawn: the notes on it, the tags it was told
 *  to light them by, and the subtrees it was told are folded. */
function canvas(): { drawing: string[]; lit: string; folded: string } {
	const surface = document.body.querySelector<HTMLElement>('[aria-label="The graph"]');
	if (!surface) throw new Error('There is no canvas on the page');
	return {
		drawing: [...surface.querySelectorAll('li > button:first-child')].map((mark) =>
			(mark.textContent ?? '').replace(/\s+/g, ' ').trim()
		),
		lit: surface.dataset.selection ?? '',
		folded: surface.dataset.collapsed ?? ''
	};
}

function marked(title: string): HTMLElement {
	const found = [
		...document.body.querySelectorAll<HTMLElement>('[aria-label="The graph"] button')
	].find((one) => (one.textContent ?? '').includes(title) && one.dataset.fold === undefined);
	if (!found) throw new Error(`${title} is not on the canvas`);
	return found;
}

function foldUnder(title: string): HTMLElement {
	const found = document.body.querySelector<HTMLElement>(`[data-fold="${title}"]`);
	if (!found) throw new Error(`${title} is not on the canvas`);
	return found;
}

/** Whether the notes are being walked rather than drawn, as the one control
 *  that says so has it. */
function walking(): boolean {
	const found = [...document.body.querySelectorAll<HTMLElement>('button')].find(
		(one) => one.getAttribute('aria-label') === 'Outline'
	);
	if (!found) throw new Error('There is nowhere to choose how the notes are seen');
	return found.getAttribute('aria-pressed') === 'true';
}

async function openGraphs(): Promise<void> {
	const found = [...document.body.querySelectorAll('button')].find(
		(one) => one.getAttribute('aria-label') === 'Your graphs'
	);
	if (!found) throw new Error('There is nowhere to choose a graph');
	found.click();
	await settle();
}

async function openFolderFromTheSheet(says: string): Promise<void> {
	const sheet = [...document.body.querySelectorAll<HTMLElement>('[role="dialog"]')].find(
		(surface) => surface.dataset.state !== 'closed'
	);
	if (!sheet) throw new Error('No surface is up over the graph');
	const row = [...sheet.querySelectorAll('li')].find((one) =>
		(one.textContent ?? '').includes(says)
	);
	const choose = row?.querySelector('button');
	if (!choose) throw new Error(`${says} is not one of the folders listed`);
	choose.click();
	await settle();
}

beforeEach(async () => {
	startAt('/');
	stubViewport();
	localStorage.clear();
	prefs.init();
	forgetTheField();
	store = new Map();
	clients = new Map();

	const thesis = client(THESIS);
	await thesis.updateGraph(await thesis.graphHere(), { title: 'The thesis' });
	await thesis.createNode({ title: 'Chapter one' });
	await thesis.createNode({ title: 'Chapter two' });

	const garden = client(GARDEN);
	await garden.updateGraph(await garden.graphHere(), { title: 'The garden' });
	await garden.createNode({ title: 'Compost' });

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
	tabs.clear();
});

describe('leaving the folder in front of the reader', () => {
	it('keeps how it was being read, every part of it', async () => {
		await serving(THESIS);
		await openGraph();
		tags.select(['seed' as Tag]);
		foldUnder('Chapter two').click();
		marked('Chapter one').click();
		await settle();
		field.at = { x: -300, y: 20, scale: 1.4 };
		const open = at.note as OwnedRef;

		await switchTo(GARDEN);

		expect(prefs.view(THESIS)).toEqual({
			graph: null,
			alsoOnCanvas: [],
			tags: ['seed'],
			walking: false,
			note: open,
			notes: [open],
			folded: [
				nodes.region({ graph: graphIn(THESIS) }).find((one) => one.title === 'Chapter two')!.ref
			],
			unfolded: [],
			viewport: { x: -300, y: 20, scale: 1.4 }
		});
	});

	it('keeps nothing of a folder taken off the reading surface', async () => {
		await serving(THESIS);
		await openGraph();

		await switchTo(GARDEN);

		expect(prefs.view(GARDEN)).toBeNull();
	});
});

describe('arriving at a folder that was read here before', () => {
	/** A reading of the garden, as somebody left it. */
	function asLeft(): FolderView {
		const compost = nodes.region({ graph: graphIn(GARDEN) })[0];
		return {
			graph: graphIn(GARDEN),
			alsoOnCanvas: [],
			tags: ['soil' as Tag],
			walking: false,
			note: compost.ref,
			notes: [compost.ref],
			folded: [compost.ref],
			unfolded: [],
			viewport: { x: 88, y: -12, scale: 0.75 }
		};
	}

	it('brings the graph, the lit tags, the notes and the folds back', async () => {
		await serving(GARDEN);
		await openGraph();
		const left = asLeft();
		await serving(THESIS);
		await openGraph();
		prefs.setView(GARDEN, left);

		await switchTo(GARDEN);

		expect(prefs.current.graph).toBe(left.graph);
		expect(prefs.current.alsoOnCanvas).toEqual([]);
		expect(tags.selected).toEqual(['soil']);
		expect(at.note).toBe(left.note);
		expect(at.notes).toEqual(left.notes);
		expect(canvas()).toEqual({
			drawing: ['Compost'],
			lit: 'soil',
			folded: left.folded[0]
		});
	});

	it('comes back to the place it was left, once the folder’s notes are drawn', async () => {
		await serving(GARDEN);
		await openGraph();
		const left = asLeft();
		await serving(THESIS);
		await openGraph();
		prefs.setView(GARDEN, left);

		await switchTo(GARDEN);

		expect(field.looked).toEqual([{ at: left.viewport, drawing: ['Compost'] }]);
		expect(field.fitted).toEqual([]);
	});

	it('walks the notes where that is how they were being seen', async () => {
		await serving(GARDEN);
		await openGraph();
		const left = { ...asLeft(), walking: true };
		await serving(THESIS);
		await openGraph();
		prefs.setView(GARDEN, left);
		expect(walking()).toBe(false);

		await switchTo(GARDEN);

		expect(walking()).toBe(true);
	});

	// There and back again: what the page puts its own sets and its own router
	// back to is what it hands over the next time the folder is left.
	it('hands the same reading back out when the folder is left again', async () => {
		await serving(GARDEN);
		await openGraph();
		const compost = nodes.region({ graph: graphIn(GARDEN) })[0].ref;
		const left: FolderView = { ...asLeft(), unfolded: [compost] };
		await serving(THESIS);
		await openGraph();
		prefs.setView(GARDEN, left);

		await switchTo(GARDEN);
		await switchTo(THESIS);

		expect(prefs.view(GARDEN)).toEqual(left);
	});
});

describe('arriving at a folder nobody has read here', () => {
	it('starts clean: its own graph, nothing lit, nothing folded, nothing open', async () => {
		await serving(THESIS);
		await openGraph();
		tags.select(['seed' as Tag]);
		foldUnder('Chapter two').click();
		marked('Chapter one').click();
		await settle();

		await switchTo(GARDEN);

		expect(prefs.current.graph).toBeNull();
		expect(prefs.current.alsoOnCanvas).toEqual([]);
		expect(tags.selected).toEqual([]);
		expect(walking()).toBe(false);
		expect(at.note).toBeNull();
		expect(at.notes).toEqual([]);
		expect(canvas()).toEqual({ drawing: ['Compost'], lit: '', folded: '' });
	});

	// Framed the way a fresh mount is: on the layout that settles under the
	// notes, rather than on the one they arrived with.
	it('frames the field once the folder’s notes are drawn, and is put nowhere', async () => {
		await serving(THESIS);
		await openGraph();

		await switchTo(GARDEN);

		expect(field.framing).toEqual([['Compost']]);
		expect(field.fitted).toEqual([]);
		expect(field.looked).toEqual([]);
	});
});

describe('the folder chosen among the ones this device keeps', () => {
	// The picker is where a folder is opened, and opening one there is the same
	// switch: the folder being left is snapshotted rather than dropped.
	it('is switched to, so the reading of the one being left is kept', async () => {
		await serving(THESIS);
		await openGraph();
		tags.select(['seed' as Tag]);
		await settle();

		await openGraphs();
		await openFolderFromTheSheet('The garden');

		expect(prefs.view(THESIS)?.tags).toEqual(['seed']);
		expect(canvas().drawing).toEqual(['Compost']);
		expect(tags.selected).toEqual([]);
	});
});
