// The graphs a person keeps, on the surface they keep them on: which one they
// are in, moving between them, and seeing more than one at once.

import type { CreateNodeRequest, GraphView, NodeView, OwnedRef } from '@sloppy/types';
import { homeGraphRef } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	AT,
	DID,
	node,
	ref,
	useFakeApi,
	VIEWER,
	type FakeApi
} from '../stores/fake-api.test-support.js';
import { graphs } from '../stores/graphs.svelte.js';
import { nodes } from '../stores/nodes.svelte.js';
import { peers } from '../stores/peers.svelte.js';
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

const HOME = homeGraphRef(DID);
const GARDEN = ref(20);

function graph(self: OwnedRef, title: string): GraphView {
	return { ref: self, created_by: DID, created_at: AT, updated_at: AT, title };
}

let listed: GraphView[];
let held: NodeView[];
let api: FakeApi;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
/** Every note the page asked the server to write, in order. */
let written: CreateNodeRequest[];
/** Graphs whose branches the server refuses, so a field can be made to fail. */
let willNotRead: Set<OwnedRef>;

function stubViewport(): void {
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: (query: string) => ({
			// Phone first: this is the width the switch has to work at.
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
	for (let turn = 0; turn < 8; turn += 1) {
		await new Promise((done) => setTimeout(done, 0));
		flushSync();
	}
}

async function open(): Promise<void> {
	session.adopt(VIEWER, 'a-session');
	mounted = mount(Graph, { target });
	flushSync();
	await settle();
}

/** The addresses the canvas has been handed, in the order it was handed them. */
const drawn = (): string[] =>
	[...document.body.querySelectorAll<HTMLElement>('[aria-label="The graph"] [data-expand]')].map(
		(mark) => mark.dataset.expand ?? ''
	);

/** A note's own control on the stand-in canvas, by the address it carries. */
function onCanvasMark(address: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('[aria-label="The graph"] button')].find(
		(mark) => mark.textContent?.trim().split(/\s+/)[0] === address
	);
	if (!found) throw new Error(`No note addressed ${address} is drawn`);
	return found as HTMLButtonElement;
}

/** The canvas itself, which carries what it is drawn over. */
function field(): HTMLElement {
	const found = document.body.querySelector<HTMLElement>('[aria-label="The graph"]');
	if (!found) throw new Error('The canvas is not drawn');
	return found;
}

/** Whether a note is open on the reading surface at all. */
const reading = () => document.body.querySelector('[aria-label="Title"]') !== null;

function button(labelled: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].find((b) =>
		b.textContent?.includes(labelled)
	);
	if (!found) throw new Error(`No "${labelled}" button on screen`);
	return found;
}

function labelled(label: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].find(
		(b) => b.getAttribute('aria-label') === label
	);
	if (!found) throw new Error(`Nothing on screen is labelled "${label}"`);
	return found as HTMLButtonElement;
}

/** What the sheet over the graph says. */
function inSheet(): string {
	const up = [...document.body.querySelectorAll<HTMLElement>('[role="dialog"]')].filter(
		(surface) => surface.dataset.state !== 'closed'
	);
	if (up.length === 0) throw new Error('No surface is up over the graph');
	return up.map((surface) => surface.textContent ?? '').join(' ');
}

async function openGraphs(): Promise<void> {
	labelled('Your graphs').click();
	await settle();
}

beforeEach(() => {
	startAt('/');
	stubViewport();
	localStorage.clear();
	prefs.init();
	nodes.clear();
	tags.clear();
	graphs.clear();
	peers.clear();
	written = [];
	willNotRead = new Set();
	listed = [graph(HOME, 'My graph'), graph(GARDEN, 'Garden')];
	held = [
		node(1, '1', { title: 'Origins' }),
		node(2, '1', { title: 'Beds', graph: GARDEN }),
		node(3, '2', { title: 'Compost', graph: GARDEN })
	];
	api = useFakeApi();
	api.on('GET /graphs', () => listed);
	api.on('GET /nodes/tags', () => []);
	api.on('GET /nodes', (url) => {
		const origin = url.searchParams.get('origin');
		if (origin) return held.filter((one) => one.origin === origin && one.ref !== origin);
		const of = url.searchParams.get('graph') ?? HOME;
		if (willNotRead.has(of as OwnedRef)) return new Response('{}', { status: 500 });
		return held.filter((one) => one.ref === one.origin && (one.graph ?? HOME) === of);
	});
	for (const one of held) {
		const [did, id] = [one.ref.slice(0, one.ref.lastIndexOf('/')), one.ref.split('/')[1]];
		const at = `/nodes/${encodeURIComponent(did)}/${encodeURIComponent(id)}`;
		api.on(`GET ${at}`, () => held.find((note) => note.ref === one.ref) ?? null);
		api.on(`GET ${at}/blocks`, () => []);
	}
	api.on('POST /nodes', (_url, init) => {
		const request = JSON.parse(String(init?.body)) as CreateNodeRequest;
		written.push(request);
		return node(90, '9', { graph: (request.from as { graph?: OwnedRef })?.graph });
	});
	api.on('POST /graphs', (_url, init) => {
		const made = graph(ref(40), (JSON.parse(String(init?.body)) as { title: string }).title);
		listed = [...listed, made];
		return made;
	});
	api.on(`PATCH /graphs/${encodeURIComponent(DID)}/${GARDEN.split('/')[1]}`, (_url, init) => {
		const named = { ...listed[1], ...(JSON.parse(String(init?.body)) as { title: string }) };
		listed = [listed[0], named];
		return named;
	});
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	session.clear();
	localStorage.clear();
	target.remove();
	document.body.innerHTML = '';
});

describe('which graph you are in', () => {
	it('names it at the head of the canvas, beside what it holds', async () => {
		await open();
		expect(labelled('Your graphs').textContent).toContain('My graph');
		expect(drawn()).toEqual(['1']);
	});

	it('opens a new one, names it, and puts the reader in it', async () => {
		await open();
		await openGraphs();
		const field = document.body.querySelector<HTMLInputElement>(
			'input[aria-label="Name the new graph"]'
		);
		if (!field) throw new Error('Nowhere to name a new graph');
		field.value = 'Thesis';
		field.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		button('Start it').click();
		await settle();
		expect(graphs.current).toBe(ref(40));
		// A graph with nothing in it yet says so under its own name.
		expect(target.textContent).toContain('Thesis starts with one note');
	});

	// A picture belongs to a graph, so moving between them changes what the
	// canvas is drawn over — DESIGN.md § "The wallpaper".
	it('draws each graph over its own picture', async () => {
		await open();
		prefs.setWallpaper(HOME, { uploads: ['dawn'], strength: 0.4, every: 60 });
		prefs.setWallpaper(GARDEN, { uploads: ['moss'], strength: 0.4, every: 60 });
		await settle();
		expect(field().dataset.wallpaper).toBe('dawn');

		await openGraphs();
		button('Garden').click();
		await settle();

		expect(field().dataset.wallpaper).toBe('moss');
	});

	it('moves into another one, and draws that one instead', async () => {
		await open();
		await openGraphs();
		button('Garden').click();
		await settle();
		expect(labelled('Your graphs').textContent).toContain('Garden');
		expect(drawn()).toEqual(['1', '2']);
	});

	// An address is assigned inside a graph, so where a new branch lands is what
	// the switch is for.
	it('writes a new branch in the graph the reader is in', async () => {
		await open();
		await openGraphs();
		button('Garden').click();
		await settle();
		button('New branch').click();
		await settle();
		expect(written).toEqual([{ from: { relation: 'branch', graph: GARDEN } }]);
	});

	it('renames one in place', async () => {
		await open();
		await openGraphs();
		labelled('Rename Garden').click();
		await settle();
		const field = document.body.querySelector<HTMLInputElement>('input[aria-label="Name"]');
		if (!field) throw new Error('Nowhere to rename a graph');
		field.value = 'Allotment';
		field.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		button('Save').click();
		await settle();
		expect(inSheet()).toContain('Allotment');
	});

	// A note open beside a canvas that no longer holds its graph is one surface
	// showing two.
	it('closes a note the canvas has stopped drawing', async () => {
		await open();
		onCanvasMark('1').click();
		await settle();
		expect(reading()).toBe(true);

		await openGraphs();
		button('Garden').click();
		await settle();

		expect(reading()).toBe(false);
	});

	// A citation resolves, whichever graph its author filed it in.
	it('moves into the graph of a note reached by its address', async () => {
		startAt(`/n/${encodeURIComponent(DID)}/${held[1].ref.split('/')[1]}`);
		await open();

		expect(graphs.current).toBe(GARDEN);
		expect(reading()).toBe(true);
	});

	// A person comes back to the graph they left off in.
	it('comes back to the graph the reader was last in', async () => {
		await open();
		await openGraphs();
		button('Garden').click();
		await settle();
		unmount(mounted!, { outro: false });
		mounted = undefined;
		prefs.init();
		await open();
		expect(labelled('Your graphs').textContent).toContain('Garden');
	});
});

// DESIGN.md § "Several graphs on one canvas": each field sits in its own place,
// and its name is written over it.
describe('more than one graph at once', () => {
	async function alsoShowGarden(): Promise<void> {
		await open();
		await openGraphs();
		labelled('Show Garden beside this one').click();
		await settle();
	}

	it('keeps the field being read drawn while another stands up beside it', async () => {
		await open();
		await openGraphs();
		labelled('Show Garden beside this one').click();
		flushSync();

		// Deliberately unsettled: this is the stretch the reader spends watching the
		// canvas while the second field reads, and what they must not lose.
		expect(document.body.querySelector('[aria-label="The graph"]')).not.toBeNull();
		expect(drawn()).toContain('1');
	});

	it('keeps the canvas when a graph standing beside it will not read', async () => {
		willNotRead.add(GARDEN);
		await alsoShowGarden();

		expect(document.body.querySelector('[aria-label="The graph"]')).not.toBeNull();
		expect(drawn()).toEqual(['1']);
		expect(document.body.textContent).toContain('Garden could not be read');
		expect(document.body.textContent).not.toContain('could not reach');
	});

	it('draws the notes of both, and says how many graphs are up', async () => {
		await alsoShowGarden();
		expect(drawn()).toEqual(['1', '1', '2']);
		expect(labelled('Your graphs').textContent).toContain('across 2 graphs');
	});

	it('hands the canvas each graph as its own field, in the order they went up', async () => {
		await alsoShowGarden();
		expect(graphs.fields).toEqual([
			{ ref: HOME, title: 'My graph' },
			{ ref: GARDEN, title: 'Garden' }
		]);
	});

	it('takes one back down again', async () => {
		await alsoShowGarden();
		await openGraphs();
		labelled('Take Garden off the canvas').click();
		await settle();
		expect(drawn()).toEqual(['1']);
	});

	// The rail is the legend for the canvas beside it, so it counts what that
	// canvas can light.
	it('counts the tags of every graph on the canvas', async () => {
		api.on('GET /nodes/tags', (url) =>
			url.searchParams.get('graph') === GARDEN
				? [{ tag: 'seed', notes: 2 }]
				: [{ tag: 'seed', notes: 3 }]
		);
		await alsoShowGarden();
		expect(tags.across(graphs.onCanvas)).toEqual([{ tag: 'seed', notes: 5 }]);
	});
});
