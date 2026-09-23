// The graphs a person keeps, on the surface they keep them on: which one they
// are in, moving between them, and seeing more than one at once.

import { HistoryError } from '@sloppy/local';
import type { CreateNodeRequest, GraphView, NodeView, OwnedRef } from '@sloppy/types';

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
import { initRuntime, type VaultAccess } from '../runtime.js';
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

const HOME = `${DID}/01ARZ3NDEKTSV4RRFFQ69G5HMM` as OwnedRef;
const GARDEN = ref(20);
/** Somebody else, whose folder this reader has opened. */
const KEEPER = 'did:syr:z6MkjChhrJfLm9WGVUAnyLPnfPGmZDcyDKNsBTsAsn7RkAqB';

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
		prefs.setWallpaper(HOME, { pictures: ['dawn'], strength: 0.4, every: 60, transition: 'fade' });
		prefs.setWallpaper(GARDEN, {
			pictures: ['moss'],
			strength: 0.4,
			every: 60,
			transition: 'fade'
		});
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
		labelled('Settings for Garden').click();
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

	// A person keeping a notebook with somebody else says it once, on the graph,
	// rather than on every note they write in it.
	it('says a new note here is only its writer’s, and saves that with the name', async () => {
		let asked: unknown = null;
		api.on(`PATCH /graphs/${encodeURIComponent(DID)}/${GARDEN.split('/')[1]}`, (_url, init) => {
			asked = JSON.parse(String(init?.body ?? '{}'));
			return { ...graph(GARDEN, 'Garden'), ownership: 'owned' };
		});
		await open();
		await openGraphs();
		labelled('Settings for Garden').click();
		await settle();

		const owned = document.body.querySelector<HTMLButtonElement>(`#owned-${CSS.escape(GARDEN)}`);
		if (!owned) throw new Error('The graph offers no choice about what it does to a new note');
		expect(inSheet()).toContain("New notes are only their writer's");
		owned.click();
		await settle();

		expect(asked).toEqual({ title: 'Garden', ownership: 'owned' });
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

	// A folder somebody shared holds their notes, so its refs carry their
	// identity and not the reader's — the link to one still opens it here.
	it('opens a note filed in a graph the reader keeps but does not own', async () => {
		const shared = `${KEEPER}/01ARZ3NDEKTSV4RRFFQ69G5HMX` as OwnedRef;
		const self = ref(50, KEEPER);
		const ulid = self.split('/')[1];
		const theirs: NodeView = {
			...node(50, '1', { created_by: KEEPER, graph: shared, title: 'Their opening' }),
			ref: self,
			origin: self
		};
		listed = [
			...listed,
			{ ref: shared, created_by: KEEPER, created_at: AT, updated_at: AT, title: 'Ours' }
		];
		held = [...held, theirs];
		const path = `/nodes/${encodeURIComponent(KEEPER)}/${encodeURIComponent(ulid)}`;
		api.on(`GET ${path}`, () => theirs);
		api.on(`GET ${path}/blocks`, () => []);
		startAt(`/n/${encodeURIComponent(KEEPER)}/${ulid}`);
		await open();

		expect(graphs.current).toBe(shared);
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

// docs/ARCHITECTURE.md § "Local-only mode": the folders this device knows ARE
// its graphs, so the picker is where one is opened, started and forgotten.
describe('the graphs a device keeps as folders', () => {
	const GARDEN_FOLDER = '/Users/me/garden';
	const HOME_FOLDER = '/Users/me/notes';
	const GONE_FOLDER = '/Users/me/moved';

	let opened: string[];
	let forgotten: string[];
	let started: number;
	/** What this device says when it will not bring a folder from an address,
	 *  and how it says it: bare across the shell's bridge, or typed by the time
	 *  it reaches the page. */
	let cloneRefusal: { said: string; as: 'bare' | 'typed' } | null;

	function keepingFolders(): VaultAccess {
		let open = HOME_FOLDER;
		let known = [
			{ root: HOME_FOLDER, graph: { ref: HOME, name: 'My graph', owner: DID }, reachable: true },
			{ root: GARDEN_FOLDER, graph: { ref: GARDEN, name: 'Garden', owner: DID }, reachable: true },
			{ root: GONE_FOLDER, reachable: false }
		];
		return {
			folder: () => open,
			graph: async () => (open === HOME_FOLDER ? HOME : GARDEN),
			asks: true,
			open: async () => open,
			known: async () => known,
			openKnown: async (root) => {
				opened.push(root);
				open = root;
			},
			forget: async (root) => {
				forgotten.push(root);
				known = known.filter((one) => one.root !== root);
			},
			start: async () => {
				started += 1;
				return open;
			},
			clone: async () => {
				if (cloneRefusal === null) return open;
				throw cloneRefusal.as === 'bare' ? cloneRefusal.said : new HistoryError(cloneRefusal.said);
			}
		};
	}

	beforeEach(() => {
		opened = [];
		forgotten = [];
		started = 0;
		cloneRefusal = null;
		initRuntime({ apiHost: () => 'http://api.test', vault: keepingFolders() });
	});

	afterEach(() => {
		initRuntime({ apiHost: () => 'http://api.test', vault: undefined });
	});

	it('lists one row per folder, and says which one is not where it was', async () => {
		await open();
		await openGraphs();

		const said = inSheet();
		expect(said).toContain('My graph');
		expect(said).toContain('Garden');
		expect(said).toContain('moved');
		expect(said).toContain('not where it was');
		expect(said).toContain('Start a folder');
	});

	it('opens the folder somebody chooses, and reads the graph in it', async () => {
		await open();
		await openGraphs();

		button('Garden').click();
		await settle();

		expect(opened).toEqual([GARDEN_FOLDER]);
		expect(graphs.current).toBe(GARDEN);
		expect(labelled('Your graphs').textContent).toContain('Garden');
	});

	it('forgets a folder without touching what is in it', async () => {
		await open();
		await openGraphs();

		labelled('Forget moved').click();
		await settle();

		expect(forgotten).toEqual([GONE_FOLDER]);
		expect(inSheet()).not.toContain('not where it was');
	});

	async function askForTheOneAt(address: string): Promise<void> {
		const field = [...document.body.querySelectorAll<HTMLInputElement>('input')].find(
			(one) => one.getAttribute('aria-label') === 'Where the graph is kept'
		);
		if (!field) throw new Error('There is nowhere to type an address');
		field.value = address;
		field.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		button('Bring it here').click();
		await settle();
	}

	it('says what this device said when it would not bring a folder from an address', async () => {
		cloneRefusal = {
			said: 'There is nothing at that address. Check it and try again.',
			as: 'bare'
		};
		await open();
		await openGraphs();

		await askForTheOneAt('https://somewhere.test/ada/garden.git');

		expect(inSheet()).toContain('There is nothing at that address. Check it and try again.');
		expect(inSheet()).not.toContain('That graph could not be brought here');
	});

	// The native shell types its own refusals on the way up, so the sentence
	// about the folder somebody picked must survive that and not be swapped for
	// advice about the address.
	it('says what this device said about the folder, however the refusal arrives', async () => {
		cloneRefusal = {
			said: 'There is already something in that folder. Choose an empty one.',
			as: 'typed'
		};
		await open();
		await openGraphs();

		await askForTheOneAt('https://somewhere.test/ada/garden.git');

		expect(inSheet()).toContain('There is already something in that folder. Choose an empty one.');
		expect(inSheet()).not.toContain('Check the address');
	});

	it('starts a graph by asking for a folder rather than for a name', async () => {
		await open();
		await openGraphs();

		expect(inSheet()).not.toContain('A new graph');
		button('Choose a folder').click();
		await settle();

		expect(started).toBe(1);
	});
});
