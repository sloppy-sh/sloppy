import type {
	ArchivePreview,
	BlockView,
	CommentAccess,
	CreateBlockRequest,
	GraphView,
	NodeBulkRequest,
	NodeView,
	OwnedRef,
	PublicationView
} from '@sloppy/types';
import { homeGraphRef, MARK_SCALE_MAX, MAX_NOTES_PER_BULK_ACT } from '@sloppy/types';
import { DEFAULT_BUDGET } from '@sloppy/graph';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	archiving,
	AT,
	DID,
	finding,
	hit,
	node,
	ref,
	refuses,
	unnumbered,
	useFakeApi,
	VIEWER,
	type FakeApi,
	type FakeArchive
} from '../stores/fake-api.test-support.js';
import { initRuntime } from '../runtime.js';
import { canvasInk } from '../stores/canvas-ink.svelte.js';
import { find } from '../stores/find.svelte.js';
import { graphs } from '../stores/graphs.svelte.js';
import { nodes } from '../stores/nodes.svelte.js';
import { outlineSections } from '../stores/outline-sections.svelte.js';
import { peers } from '../stores/peers.svelte.js';
import { prefs } from '../stores/prefs.svelte.js';
import { publications } from '../stores/publications.svelte.js';
import { session } from '../stores/session.svelte.js';
import { tags } from '../stores/tags.svelte.js';
import { at, back, forward, pushed, replaced, startAt } from './page.test-support.svelte.js';

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

const FIRST = ref(1);
const SECOND = ref(2);
const THIRD = ref(3);

let api: FakeApi;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let graph: Map<OwnedRef, NodeView>;
/** What this person has published, as the instance answers for it. */
let held: PublicationView[];
/** Every act the server was asked for, in the order it was asked. */
let acts: NodeBulkRequest[];

/** A branch this person publishes, rooted at `root`. */
function publication(
	seed: number,
	root: OwnedRef,
	rootAddress: string,
	comments: CommentAccess = 'anyone'
): PublicationView {
	const self = ref(seed);
	return {
		ref: self,
		created_by: DID,
		created_at: AT,
		updated_at: AT,
		root,
		root_address: rootAddress,
		comments,
		latest: { ref: ref(seed + 100), sequence: 1, published_at: AT }
	};
}

/** What one act leaves a note as, standing in for the server that writes it. */
function acted(note: NodeView, act: NodeBulkRequest['act']): NodeView {
	switch (act.act) {
		case 'tag':
			return { ...note, tags: [...new Set([...note.tags, ...act.tags])] };
		case 'untag':
			return { ...note, tags: note.tags.filter((tag) => !act.tags.includes(tag)) };
		case 'publish':
			return { ...note, published: true };
		case 'set_appearance':
			return { ...note, appearance: act.appearance ?? undefined };
		default:
			return note;
	}
}

/** A ref as the two path segments every route binds it as. */
function segments(of: OwnedRef): string {
	const cut = of.lastIndexOf('/');
	return `${encodeURIComponent(of.slice(0, cut))}/${encodeURIComponent(of.slice(cut + 1))}`;
}

function path(of: OwnedRef): string {
	return `/nodes/${segments(of)}`;
}

/** `answers` decides which media queries hold: the default is the widest
 *  surface, and a phone is the one that answers `(max-width: 639px)`. */
function stubViewport(answers: (query: string) => boolean = () => false): void {
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: (query: string) => ({
			matches: answers(query),
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
	for (let turn = 0; turn < 6; turn += 1) {
		await new Promise((done) => setTimeout(done, 0));
		flushSync();
	}
	for (let frame = 0; frame < 3; frame += 1) await new Promise(requestAnimationFrame);
	flushSync();
}

function installGraph(): Map<OwnedRef, NodeView> {
	const held = new Map<OwnedRef, NodeView>([
		[FIRST, node(1, '1', { title: 'Origins' })],
		[SECOND, node(2, '1a', { title: 'Cells', origin: FIRST, parent: FIRST })],
		[THIRD, node(3, '2', { title: 'Method' })]
	]);
	api.on('GET /nodes/tags', () => []);
	api.on('GET /nodes', (url) => {
		const origin = url.searchParams.get('origin');
		return [...held.values()].filter((n) => (origin ? n.origin === origin : n.ref === n.origin));
	});
	for (const of of [FIRST, SECOND, THIRD]) {
		api.on(`GET ${path(of)}`, () => held.get(of) ?? null);
		api.on(`GET ${path(of)}/blocks`, () => []);
		api.on(`PATCH ${path(of)}`, (_url, init) => {
			const before = held.get(of);
			if (!before) return null;
			const after = { ...before, ...(JSON.parse(String(init?.body)) as Partial<NodeView>) };
			held.set(of, after);
			return after;
		});
	}
	return held;
}

/** A note's control on the stand-in canvas, by the address it carries. */
function onCanvas(address: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('[aria-label="The graph"] button')].find(
		(b) => b.textContent?.trim().split(/\s+/)[0] === address
	);
	if (!found) throw new Error(`No note addressed ${address} is drawn`);
	return found as HTMLButtonElement;
}

/** The control that opens what a drawn note stands for. */
function fold(address: string): HTMLButtonElement {
	const found = document.body.querySelector<HTMLButtonElement>(`[data-expand="${address}"]`);
	if (!found) throw new Error(`No note addressed ${address} is drawn`);
	return found;
}

/** A note's row in the outline, by the address it carries. */
function inOutline(address: string): HTMLElement {
	const found = [...document.body.querySelectorAll('[role="treeitem"]')].find(
		(row) => row.querySelector('.address')?.textContent?.trim() === address
	);
	if (!found) throw new Error(`No row of the outline is addressed ${address}`);
	return found as HTMLElement;
}

/** Where the canvas has been told the reader is looking. */
const looking = () =>
	document.body.querySelector<HTMLElement>('[aria-label="The graph"]')?.dataset.focus;

/** The notes the canvas has been asked to come to, in the order it was asked. */
const brought = () =>
	document.body
		.querySelector<HTMLElement>('[aria-label="The graph"]')
		?.dataset.brought?.split(' ')
		.filter(Boolean) ?? [];

/** How often the canvas has been asked for the whole field. */
const fitted = () =>
	Number(document.body.querySelector<HTMLElement>('[aria-label="The graph"]')?.dataset.fitted ?? 0);

/** Whether the canvas has been handed a pen to ink with. */
const inkingOnCanvas = () =>
	document.body.querySelector<HTMLElement>('[aria-label="The graph"]')?.dataset.inking;

/** Whether the canvas has been handed a set to choose into. */
const choosingOnCanvas = () =>
	document.body.querySelector<HTMLElement>('[aria-label="The graph"]')?.dataset.choosing;

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

const screen = () => document.body.textContent ?? '';

/** The canvas's menu, asked for on a note or on the bare field. */
function menuOn(what: string): HTMLButtonElement {
	const found = document.body.querySelector<HTMLButtonElement>(`[data-menu="${what}"]`);
	if (!found) throw new Error(`Nothing on the canvas answers a menu on ${what}`);
	return found;
}

function item(label: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
		(row) => row.textContent?.trim() === label
	);
	if (!found) throw new Error(`The menu does not offer "${label}"`);
	return found;
}

const offered = (): string[] =>
	[...document.body.querySelectorAll('[role="menuitem"]')].map(
		(row) => row.textContent?.trim() ?? ''
	);

function typeTag(word: string): void {
	const field = document.body.querySelector<HTMLInputElement>('input[role="combobox"]');
	if (!field) throw new Error('No tag field is on screen');
	field.value = word;
	field.dispatchEvent(new Event('input', { bubbles: true }));
	field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

/** The rail's own find field, which it offers only once it is crowded, and
 *  which stands in the chip's place until the chip is tapped. */
function findTag(word: string): void {
	[...document.body.querySelectorAll('button')]
		.find((b) => b.getAttribute('aria-label') === 'Find a tag')
		?.click();
	flushSync();
	const field = document.body.querySelector<HTMLInputElement>('input[aria-label="Find a tag"]');
	if (!field) throw new Error('The rail is offering nowhere to type');
	field.value = word;
	field.dispatchEvent(new Event('input', { bubbles: true }));
}

/** The tags the rail is drawing, in the order it draws them. */
const railChips = (): string[] => {
	const field = document.body.querySelector<HTMLInputElement>('input[aria-label="Find a tag"]');
	const root = field?.parentElement;
	if (!root) throw new Error('The rail is offering nowhere to type');
	return [...root.querySelectorAll('button[aria-pressed]')].map(
		(chip) => chip.textContent?.trim().split(/\s+/)[0] ?? ''
	);
};

/** The rail's find control, whose label carries the key that does the same. */
function findControl(): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].find((b) =>
		(b.getAttribute('aria-label') ?? '').startsWith('Find a note')
	);
	if (!found) throw new Error('The rail is offering no way to find a note');
	return found as HTMLButtonElement;
}

function findField(): HTMLInputElement {
	const input = document.body.querySelector<HTMLInputElement>('input[aria-label^="Find a note"]');
	if (!input) throw new Error('No find field is on screen');
	return input;
}

async function typeToFind(words: string): Promise<void> {
	const field = findField();
	field.value = words;
	field.dispatchEvent(new Event('input', { bubbles: true }));
	await settle();
}

/** What the note's leading control says, which is what it does. */
function wayOut(): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].find((b) =>
		['Graph', 'Back'].includes(b.textContent?.trim() ?? '')
	);
	if (!found) throw new Error('The note on screen has no way out');
	return found as HTMLButtonElement;
}

/** The words the tag field is showing. */
const chips = (): string[] =>
	[...document.body.querySelectorAll('button[aria-label^="Remove "]')].map((chip) =>
		(chip.getAttribute('aria-label') ?? '').replace('Remove ', '')
	);

/** What the surface over the graph says. The bar it covers is still in the
 *  document and says some of the same things, so `screen()` cannot tell
 *  whether the person who caused a message can read it. */
function inSheet(): string {
	const up = [...document.body.querySelectorAll<HTMLElement>('[role="dialog"]')].filter(
		(surface) => surface.dataset.state !== 'closed'
	);
	if (up.length === 0) throw new Error('No surface is up over the graph');
	return up.map((surface) => surface.textContent ?? '').join(' ');
}

async function open(): Promise<void> {
	// A page listens on the window for as long as it is mounted, so a test that
	// opens the graph twice would be answered by both of them.
	if (mounted) unmount(mounted, { outro: false });
	session.adopt(VIEWER, 'a-session');
	mounted = mount(Graph, { target });
	flushSync();
	await settle();
}

/** The shapes, which the chrome offers only where there is no note yet to open
 *  "Add a shape" inside. */
async function fromNothing(): Promise<void> {
	api.on('GET /nodes', () => []);
	await open();
	button('Start from a shape').click();
	await settle();
}

/** Whether a note is open on the reading surface at all. */
const reading = () => document.body.querySelector('[aria-label="Title"]') !== null;

/** What the surface holding the note is called, as a screen reader reads it. */
function readingName(): string {
	const up = [...document.body.querySelectorAll<HTMLElement>('[role="dialog"]')].filter(
		(surface) => surface.dataset.state !== 'closed'
	);
	const surface = up[up.length - 1];
	if (!surface) throw new Error('No note is open on the reading surface');
	const by = surface.getAttribute('aria-labelledby');
	return (
		(by ? document.getElementById(by)?.textContent : surface.getAttribute('aria-label'))?.trim() ??
		''
	);
}

/** Whatever the page has said out loud since it was mounted. */
const said = (): string[] =>
	[...document.body.querySelectorAll('[role="status"]')].map(
		(one) => one.textContent?.trim() ?? ''
	);

/** Ask, from the note on screen, for what it links to to be picked on the graph.
 *  Everything that is not writing waits behind one control at its head. */
async function pointFromNote(): Promise<void> {
	labelled('What to do with this note').click();
	await settle();
	button('Link to another note').click();
	await settle();
	button('Point at it on the graph').click();
	await settle();
}

/** Open `1a` and ask for the note it links to to be picked on the graph. */
async function startLinking(): Promise<void> {
	await open();
	onCanvas('1a').click();
	await settle();
	await pointFromNote();
}

beforeEach(() => {
	startAt('/');
	stubViewport();
	nodes.clear();
	outlineSections.clear();
	peers.clear();
	tags.clear();
	publications.clear();
	find.clear();
	api = useFakeApi();
	graph = installGraph();
	held = [];
	api.on('GET /publications', () => held);
	acts = [];
	api.on('POST /nodes/bulk', (_url, init) => {
		const request = JSON.parse(String(init?.body)) as NodeBulkRequest;
		acts.push(request);
		const reached = request.notes.map((of) => graph.get(of)).filter((note) => note !== undefined);
		const act = request.act;
		if (act.act === 'delete') {
			for (const of of request.notes) graph.delete(of);
			return { reached: reached.length, missed: 0, notes: [] };
		}
		const notes = reached.map((note) => {
			const after: NodeView = acted(note, act);
			graph.set(after.ref, after);
			return after;
		});
		return { reached: notes.length, missed: 0, notes };
	});
	canvasInk.rubOut(HOME);
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	// Walking the notes outlives a mount by design, and so do the branches it was
	// left open on, so both are put back rather than left for whatever runs next.
	for (let deep = 0; deep < 8; deep += 1) {
		const open = [...document.body.querySelectorAll<HTMLButtonElement>('[aria-label^="Fold "]')];
		if (open.length === 0) break;
		for (const branch of open) branch.click();
		flushSync();
	}
	document.body.querySelector<HTMLButtonElement>('button[aria-label="Back to the graph"]')?.click();
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	session.clear();
	target.remove();
	document.body.innerHTML = '';
});

// PRODUCT.md: the graph is where the answer is read, so a note opened anywhere
// else has to be findable on it.
describe('finding your way back on the canvas', () => {
	it('comes to a note opened from the graph', async () => {
		await open();

		onCanvas('1a').click();
		await settle();

		expect(brought()).toEqual([SECOND]);
	});

	it('comes to a note opened from the list of what was last written', async () => {
		finding(api, { recent: [node(2, '1a', { title: 'Cells', origin: FIRST, parent: FIRST })] });
		await open();

		labelled('Walk the notes one at a time').click();
		await settle();
		expect(brought()).toEqual([]);

		const head = document.body.querySelector<HTMLElement>(`[data-row="lead:${SECOND}"]`);
		if (!head) throw new Error('The walk is not headed by what was last written');
		head.click();
		await settle();

		expect(brought()).toEqual([SECOND]);
	});

	it('comes to the note a citation opened', async () => {
		const cut = SECOND.lastIndexOf('/');
		startAt(
			`/n/${encodeURIComponent(SECOND.slice(0, cut))}/${encodeURIComponent(SECOND.slice(cut + 1))}`
		);
		await open();

		expect(brought()).toEqual([SECOND]);
	});

	it('comes again when the note already open is opened again', async () => {
		await open();

		onCanvas('1a').click();
		await settle();
		onCanvas('1a').click();
		await settle();

		expect(brought()).toEqual([SECOND, SECOND]);
	});

	it('fits the whole field when the reader asks where they are', async () => {
		await open();
		expect(fitted()).toBe(0);

		labelled('See everything on the canvas').click();
		await settle();

		expect(fitted()).toBe(1);
	});
});

// A held region is drawn on the same canvas, so opening a note in somebody
// else's branch is the same act as opening one of your own.
// PRODUCT.md § Design Principles 2 and 3: the address is assigned for you, and
// the interface says so. A reader who cannot see the header is owed it too.
describe('what the graph says out loud', () => {
	const WRITTEN = ref(9);

	it('names an open note by its address before its title', async () => {
		await open();

		onCanvas('1a').click();
		await settle();

		expect(readingName()).toBe('1a · Cells');
	});

	it('calls a note nobody has titled yet by its address', async () => {
		graph.set(SECOND, { ...graph.get(SECOND)!, title: '' });
		await open();

		onCanvas('1a').click();
		await settle();

		expect(readingName()).toBe('1a · Untitled');
	});

	it('says the address a note was just given', async () => {
		api.on('POST /nodes', () => node(9, '3'));
		api.on(`GET ${path(WRITTEN)}`, () => node(9, '3'));
		api.on(`GET ${path(WRITTEN)}/blocks`, () => []);
		await open();
		expect(said()).not.toContain('Your new note is 3.');

		button('New branch').click();
		await settle();

		expect(said()).toContain('Your new note is 3.');
	});
});

describe('a branch somebody else published', () => {
	const AUTHOR = 'did:syr:z6MkpTHR8VNsBxYAAWHut2Geadd9jSLuFvdmsZ2mFmZjMxYZ';
	const REGION = ref(20);
	const ROOT = ref(21, AUTHOR);
	const UNDER = ref(22, AUTHOR);

	const theirs = (seed: number, address: string, over: Partial<NodeView> = {}): NodeView => ({
		...node(seed, address),
		ref: ref(seed, AUTHOR),
		created_by: AUTHOR,
		origin: ROOT,
		...over
	});

	beforeEach(() => {
		api.on('GET /following', () => []);
		api.on('GET /pulls', () => [
			{
				ref: REGION,
				created_by: DID,
				publication: ref(30, AUTHOR),
				version: { ref: ref(31, AUTHOR), sequence: 1, published_at: AT },
				root_address: '1',
				comments: 'anyone',
				source_url: 'http://peer.test',
				created_at: AT,
				updated_at: AT
			}
		]);
		api.on(`GET /pulls/${segments(REGION)}/nodes`, () => [
			theirs(21, '1', { title: 'Their origins' }),
			theirs(22, '1a', { title: 'Their cells', parent: ROOT })
		]);
		api.on(`GET /pulls/nodes/${segments(UNDER)}/blocks`, () => []);
	});

	/** Onto the canvas of a region the reader holds, from the sheet that lists
	 *  what they are holding. */
	async function enterRegion(): Promise<void> {
		await open();
		labelled('More').click();
		await settle();
		item("Other people's graphs").click();
		await settle();
		button(AUTHOR).click();
		await settle();
	}

	it('comes to a held note opened from the canvas', async () => {
		await enterRegion();

		onCanvas('1a').click();
		await settle();

		expect(brought()).toEqual([UNDER]);
	});

	// DESIGN.md § "The mark": the lift is the only thing that says which note is
	// being read, and a peer in somebody else's branch has the least to go on.
	it('lifts the held note being read', async () => {
		await enterRegion();
		expect(onCanvas('1a').dataset.lifted).toBeUndefined();

		onCanvas('1a').click();
		await settle();

		expect(onCanvas('1a').dataset.lifted).toBe('reading');
		expect(onCanvas('1').dataset.lifted).toBeUndefined();
	});

	it('comes to a held note opened from a row of the outline', async () => {
		await enterRegion();

		labelled('Walk the notes one at a time').click();
		await settle();
		labelled('Unfold 1').click();
		await settle();
		inOutline('1a').click();
		await settle();

		expect(brought()).toEqual([UNDER]);
	});
});

describe('linking by pointing at the graph', () => {
	it('puts the graph forward, saying which note the choice is for', async () => {
		await startLinking();

		expect(screen()).toContain('Tap a note to link it to');
		expect(screen()).toContain('1a');
		// The note steps aside: on a phone the choice is the whole screen.
		expect(reading()).toBe(false);
	});

	// DESIGN.md § Layout, remove-empty chrome: the canvas is answering a question,
	// so what only changes how it is looked at has nothing to do here — and inking
	// is off while it does.
	it('takes what only changes the view off the picture while the graph is asked', async () => {
		await startLinking();

		expect(() => labelled('See everything on the canvas')).toThrow();
		expect(() => labelled('Walk the notes one at a time')).toThrow();
		expect(() => labelled('Background')).toThrow();
	});

	it('marks the note being pointed from, so it is findable on the canvas', async () => {
		await startLinking();

		expect(onCanvas('1a').dataset.marked).toBe('from');
		expect(onCanvas('2').dataset.marked).toBeUndefined();
	});

	it('links the note that was tapped and comes back to the one being written', async () => {
		await startLinking();

		onCanvas('2').click();
		await settle();

		expect(graph.get(SECOND)?.links).toEqual([THIRD]);
		expect(screen()).toContain('Links to');
		expect(screen()).toContain('Method');
	});

	it('marks what it already links to, and never writes a second copy', async () => {
		graph.set(SECOND, { ...graph.get(SECOND)!, links: [THIRD] });
		await startLinking();
		expect(onCanvas('2').dataset.marked).toBe('taken');

		onCanvas('2').click();
		await settle();

		expect(graph.get(SECOND)?.links).toEqual([THIRD]);
		expect(screen()).toContain('Links to');
	});

	it('leaves the note untouched when the reader wants no link after all', async () => {
		await startLinking();

		button('Never mind').click();
		await settle();

		expect(graph.get(SECOND)?.links).toEqual([]);
		expect(reading()).toBe(true);
	});

	// Finding the note is half of pointing at it, so the level of detail has to
	// follow the reader into the fold they open rather than pulling them back.
	it('follows the reader into a fold opened to reach a note', async () => {
		await startLinking();
		expect(looking()).toBe(SECOND);

		fold('1').click();
		await settle();

		expect(looking()).toBe(FIRST);
	});

	// The canvas answers a pointer; the way out has to answer a keyboard too.
	it('leaves the choice on Escape', async () => {
		await startLinking();

		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		await settle();

		expect(graph.get(SECOND)?.links).toEqual([]);
		expect(reading()).toBe(true);
	});

	it('says so where the link would not save, and stays on the graph', async () => {
		await startLinking();
		api.on(
			`PATCH ${path(SECOND)}`,
			() => new Response('{"message":"Not right now."}', { status: 503 })
		);

		onCanvas('2').click();
		await settle();

		expect(screen()).toContain('Not right now.');
		expect(screen()).toContain('Tap a note to link it to');
	});
});

// A right-click and a press-and-hold are how somebody asks what they can do to
// the note under the pointer, and the answer is about that note.
describe('acting on one note from the canvas', () => {
	async function askAbout(address: string): Promise<void> {
		await open();
		menuOn(address).click();
		await settle();
	}

	it('offers what can be done to the note, with choosing several as one row', async () => {
		await askAbout('1');

		expect(offered()).toEqual([
			'Open it',
			'Write a note under this',
			'Tags',
			'Give it a look',
			'Fold what is under this',
			'Choose this and others',
			'Delete it'
		]);
	});

	// PRODUCT.md § "Capture is one gesture": the thought that springs from a note
	// is put down from where the reader is looking at it.
	it('writes the note under the one held, and opens that instead', async () => {
		const WRITTEN = ref(9);
		let placed: unknown;
		api.on('POST /nodes', (_url, init) => {
			placed = (JSON.parse(String(init?.body)) as { from?: unknown }).from;
			return node(9, '1a1', { origin: FIRST, parent: SECOND });
		});
		api.on(`GET ${path(WRITTEN)}`, () => node(9, '1a1', { origin: FIRST, parent: SECOND }));
		api.on(`GET ${path(WRITTEN)}/blocks`, () => []);

		await askAbout('1a');
		item('Write a note under this').click();
		await settle();

		expect(placed).toEqual({ relation: 'under', note: SECOND });
		expect(reading()).toBe(true);
	});

	it('opens the note', async () => {
		await askAbout('1a');

		item('Open it').click();
		await settle();

		expect(screen()).toContain('Cells');
	});

	// Acting on the note under the pointer must not leave the canvas in the mode
	// for several — that mode was the whole of what the menu used to offer.
	it('tags that note alone, without starting to choose', async () => {
		await askAbout('1a');

		item('Tags').click();
		await settle();
		expect(inSheet()).toContain('Tag this note');
		typeTag('method');
		await settle();

		expect(acts).toEqual([{ notes: [SECOND], act: { act: 'tag', tags: ['method'] } }]);
		expect(graph.get(SECOND)?.tags).toEqual(['method']);
		expect(screen()).not.toContain('note chosen');
		expect(choosingOnCanvas()).toBeUndefined();
	});

	// A picture is part of how one note is drawn, and the canvas is where somebody
	// is looking at the mark that would carry it. The set's sheet cannot offer one.
	it('gives it the look surface a picture can be put on', async () => {
		await askAbout('1a');

		item('Give it a look').click();
		await settle();
		expect(inSheet()).toContain('How this note looks');
		expect(inSheet()).toContain('Add a picture');

		button('Heavy').click();
		await settle();

		expect(acts).toEqual([
			{ notes: [SECOND], act: { act: 'set_appearance', appearance: { ring_weight: 'heavy' } } }
		]);
	});

	// The words the rest of the product asks this in — never a second wording for
	// the same question.
	it('asks before deleting it, counting what goes with it', async () => {
		await askAbout('1');

		item('Delete it').click();
		await settle();
		expect(screen()).toContain('Delete this note?');
		expect(screen()).toContain('It goes, and so does the one note that grew out of it.');
		expect(acts).toEqual([]);

		button('Delete it').click();
		await settle();

		expect(acts).toEqual([{ notes: [FIRST], act: { act: 'delete' } }]);
		expect(graph.has(FIRST)).toBe(false);
	});

	it('starts choosing with that note already in the set', async () => {
		await askAbout('2');

		item('Choose this and others').click();
		await settle();

		expect(screen()).toContain('1 note chosen');
		expect(onCanvas('2').dataset.chosen).toBe('yes');
	});
});

// DESIGN.md § "The mark" keeps the word "chosen" for the notes somebody picked
// out to act on; a selection is already the reader's tags.
describe('choosing several notes to act on', () => {
	/** One note through its own menu, which is the phone's way in. */
	async function chooseOnly(address: string): Promise<void> {
		await open();
		menuOn(address).click();
		await settle();
		item('Choose this and others').click();
		await settle();
	}

	/** `1` through the menu, then `1a` and `2` by tapping: the mode is entered by
	 *  name and then taps add to it. */
	async function chooseThree(): Promise<void> {
		await chooseOnly('1');
		onCanvas('1a').click();
		onCanvas('2').click();
		await settle();
	}

	it('counts what is chosen and marks it on the canvas', async () => {
		await chooseThree();

		expect(screen()).toContain('3 notes chosen');
		expect(onCanvas('1').dataset.chosen).toBe('yes');
		expect(onCanvas('1a').dataset.chosen).toBe('yes');
	});

	// The bare field is a different question from a note, and starting to choose
	// is what it is for.
	it('offers different acts on a note and on the bare field', async () => {
		await open();
		menuOn('the canvas').click();
		await settle();
		expect(offered()).toEqual(['New branch', 'New note', 'Choose notes']);

		item('Choose notes').click();
		await settle();
		onCanvas('1').click();
		await settle();
		menuOn('the canvas').click();
		await settle();
		expect(offered()).toEqual([
			'Tags',
			'Give them a look',
			'Publish it',
			'Delete it',
			'Done choosing'
		]);
	});

	it('tags every chosen note at once', async () => {
		await chooseThree();

		button('Tags').click();
		await settle();
		typeTag('method');
		await settle();

		expect(acts).toEqual([
			{ notes: [FIRST, SECOND, THIRD], act: { act: 'tag', tags: ['method'] } }
		]);
		expect(graph.get(SECOND)?.tags).toEqual(['method']);
		// The chips are every word any of them carries, so the question says so.
		expect(inSheet()).toContain('A word on any of them shows here.');
	});

	// The sheet is the one surface built for writing several words in a row, so
	// the second Enter is asked for while the first is still going. Dropping it
	// takes the chip away without a word, on the surface built to invite it.
	it('keeps a word typed while the one before it is still going', async () => {
		await chooseThree();

		button('Tags').click();
		await settle();
		typeTag('method');
		typeTag('question');
		await settle();

		expect(graph.get(FIRST)?.tags).toEqual(['method', 'question']);
		expect(chips()).toEqual(['method', 'question']);
	});

	it('gives every chosen note one look, in shape alone', async () => {
		await chooseThree();

		button('Look').click();
		await settle();
		button('Heavy').click();
		await settle();
		button('Give them this look').click();
		await settle();

		expect(acts).toEqual([
			{
				notes: [FIRST, SECOND, THIRD],
				act: { act: 'set_appearance', appearance: { ring_weight: 'heavy' } }
			}
		]);
	});

	// A set of one is still a set somebody built by hand, so neither question may
	// talk about them.
	it('asks about one chosen note in the singular', async () => {
		await chooseOnly('1');

		button('Tags').click();
		await settle();

		expect(inSheet()).toContain('Tag this note');
		expect(inSheet()).toContain('Anything you add goes on this note');
	});

	it('offers a look to one chosen note in the singular', async () => {
		await chooseOnly('1');

		button('Look').click();
		await settle();

		expect(inSheet()).toContain('Give this note a look');
		expect(inSheet()).toContain('including any picture on it.');
		expect(button('Give it this look')).toBeTruthy();
	});

	// An untouched dialog carries no look, and writing one anyway is the same act
	// as the button beside it — which also takes off a picture nobody asked about.
	it('offers no look until one has been picked', async () => {
		await chooseThree();

		button('Look').click();
		await settle();
		expect(button('Give them this look').disabled).toBe(true);

		const thumb = document.body.querySelector<HTMLElement>('[role="slider"]');
		if (!thumb) throw new Error('the look has no size to drag');
		thumb.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
		await settle();
		expect(button('Give them this look').disabled).toBe(false);

		button('Give them this look').click();
		await settle();
		expect(acts).toEqual([
			{
				notes: [FIRST, SECOND, THIRD],
				act: { act: 'set_appearance', appearance: { mark_scale: MARK_SCALE_MAX } }
			}
		]);
	});

	// The dialog outlives every set it is opened over, so a look left in it would
	// be offered to the next notes as though somebody had picked it for them.
	it('opens the look with nothing picked, whatever was picked last time', async () => {
		await chooseThree();

		button('Look').click();
		await settle();
		button('Heavy').click();
		await settle();
		button('Cancel').click();
		await settle();

		button('Look').click();
		await settle();

		expect(button('Give them this look').disabled).toBe(true);
	});

	// The question counts everything that goes — the notes chosen are never all
	// of them.
	it('asks before deleting, counting what goes with the notes chosen', async () => {
		await chooseOnly('1');

		button('Delete').click();
		await settle();
		expect(screen()).toContain('Delete this note?');
		expect(screen()).toContain('It goes, and so does the one note that grew out of it.');
		expect(acts).toEqual([]);

		button('Delete it').click();
		await settle();

		expect(acts).toEqual([{ notes: [FIRST], act: { act: 'delete' } }]);
		expect(graph.has(FIRST)).toBe(false);
		expect(screen()).not.toContain('chosen');
	});

	// A note already chosen is not counted twice for being under another one.
	it('counts a whole branch once, however much of it was chosen', async () => {
		await chooseThree();

		button('Delete').click();
		await settle();

		expect(screen()).toContain('Delete these 3 notes?');
		expect(screen()).toContain('They go.');
	});

	// The server reaches what is still there and counts the rest; reporting a
	// partial success as a clean one is telling somebody their tag landed on a
	// note it never reached.
	it('says how much of what was chosen was already gone', async () => {
		await chooseThree();
		api.on('POST /nodes/bulk', () => ({
			reached: 2,
			missed: 1,
			notes: [graph.get(FIRST)!, graph.get(SECOND)!]
		}));

		button('Tags').click();
		await settle();
		typeTag('method');
		await settle();

		expect(inSheet()).toContain('One of the notes you chose was already gone.');
	});

	// The bar goes with the set, so a delete has to say it somewhere else.
	it('says it beside the graph where the delete was the partial one', async () => {
		await chooseThree();
		api.on('POST /nodes/bulk', () => ({ reached: 1, missed: 2, notes: [] }));

		button('Delete').click();
		await settle();
		button('Delete 3 notes').click();
		await settle();

		expect(screen()).not.toContain('notes chosen');
		expect(screen()).toContain('2 of the notes you chose were already gone.');
	});

	it('publishes every chosen note in one act', async () => {
		await chooseThree();

		button('Publish').click();
		await settle();
		expect(inSheet()).toContain('Publish these 3 notes?');
		button('Publish 3 notes').click();
		await settle();

		expect(acts).toEqual([{ notes: [FIRST, SECOND, THIRD], act: { act: 'publish' } }]);
		expect(graph.get(SECOND)?.published).toBe(true);
	});

	// PRODUCT.md § "Design Principles" 5: said once, for the set, at the decision.
	it('says what publishing puts out, for the whole set', async () => {
		await chooseThree();

		button('Publish').click();
		await settle();

		const asked = inSheet();
		expect(asked).toContain('Everything under these 3 notes goes out');
		expect(asked).toContain('Anyone who can find your profile can read them');
		expect(asked).toContain('whoever has already read them keeps their copy');
	});

	// Sending twenty branches again is a different act from putting out what is
	// not out yet, so it is not done quietly.
	it('says how many of them are already published before sending them again', async () => {
		held = [
			publication(10, FIRST, '1'),
			publication(11, SECOND, '1a'),
			publication(12, THIRD, '2')
		];
		await chooseThree();

		button('Publish').click();
		await settle();

		expect(inSheet()).toContain('the 3 you have already published');
	});

	// A note inside a published branch roots nothing: publishing it opens a
	// publication of its own, with no version behind it.
	it('counts only the chosen notes a publication of their own is rooted at', async () => {
		held = [publication(10, FIRST, '1')];
		// What `1`'s publication carries draws as published, and roots nothing.
		graph.set(SECOND, { ...graph.get(SECOND)!, published: true });
		await chooseOnly('1a');

		button('Publish').click();
		await settle();

		const asked = inSheet();
		expect(asked).not.toContain('already published');
		expect(asked).toContain('1 already carries the note you chose, on its own terms.');
	});

	// The carrier is going out in this same act, so the writing under it goes out
	// once and there is nothing to warn about.
	it('says nothing about a carrier that is itself in the chosen set', async () => {
		held = [publication(10, FIRST, '1')];
		await chooseOnly('1');
		onCanvas('1a').click();
		await settle();

		button('Publish').click();
		await settle();

		const asked = inSheet();
		expect(asked).toContain('the one you have already published');
		expect(asked).not.toContain('already carries');
	});

	// Its chain is its own: the carrier's snapshot does not advance it, so it
	// goes out too and the question counts it.
	it('counts a chain of its own inside another chosen note', async () => {
		held = [publication(10, FIRST, '1'), publication(11, SECOND, '1a')];
		await chooseOnly('1');
		onCanvas('1a').click();
		await settle();

		button('Publish').click();
		await settle();

		expect(inSheet()).toContain('the 2 you have already published');
	});

	// PRODUCT.md § "Design Principles" 5: what a publish widens is said at the
	// decision, so it cannot be waiting on a read the decision started.
	it('reads what is already published before the question is asked', async () => {
		held = [publication(10, FIRST, '1')];
		await chooseOnly('1');

		expect(api.calls.filter((call) => call === 'GET /publications')).toHaveLength(1);
		expect(publications.state.loaded).toBe(true);
	});

	it('says so where it could not read what is already published', async () => {
		api.on('GET /publications', () => {
			throw new Error('the connection went away');
		});
		await chooseThree();

		button('Publish').click();
		await settle();

		expect(inSheet()).toContain('Sloppy could not check which of those notes are published.');
	});

	it('says a branch under the chosen set invites fewer people to answer', async () => {
		held = [publication(10, SECOND, '1a', 'nobody')];
		await chooseOnly('1');

		button('Publish').click();
		await settle();

		expect(inSheet()).toContain('1a is published inviting fewer people to answer.');
	});

	// The blanket promise is about what goes out for the first time; a chain
	// already set to take no answers keeps that.
	it('says publishing again leaves the terms already set on it', async () => {
		held = [publication(10, FIRST, '1', 'nobody')];
		await chooseOnly('1');

		button('Publish').click();
		await settle();

		expect(inSheet()).toContain('What you have already published keeps the terms you set on it.');
	});

	// Each note is published on its own, so a request that stops partway leaves
	// some of them readable while the person is still being asked.
	it('says some may be out where publishing stopped partway', async () => {
		await chooseThree();
		api.on('POST /nodes/bulk', () => {
			throw new Error('the connection went away');
		});

		button('Publish').click();
		await settle();
		button('Publish 3 notes').click();
		await settle();

		expect(inSheet()).toContain('Some of them may be out.');
	});

	it('says how many of the chosen did not go out', async () => {
		await chooseThree();
		api.on('POST /nodes/bulk', () => ({ reached: 2, missed: 1, notes: [] }));

		button('Publish').click();
		await settle();
		button('Publish 3 notes').click();
		await settle();

		expect(screen()).toContain('One of the notes you chose did not go out.');
	});

	// DESIGN.md § "Mobile and tablet first": the surface a phone gets is the one
	// the act is asked for on, so it is asked for there.
	it('publishes the chosen set from the sheet a phone gets', async () => {
		stubViewport((query) => query.includes('max-width: 639px'));
		await chooseThree();

		button('Publish').click();
		await settle();
		expect(document.body.querySelector('[data-slot="modal-grabber"]')).not.toBeNull();
		expect(inSheet()).toContain('Publish these 3 notes?');
		button('Publish 3 notes').click();
		await settle();

		expect(acts).toEqual([{ notes: [FIRST, SECOND, THIRD], act: { act: 'publish' } }]);
	});

	// DESIGN.md § Layout: a component renders only when it has something to do,
	// and choosing by name lands somebody here before they have chosen anything.
	it('offers no act until something is chosen', async () => {
		await open();
		menuOn('the canvas').click();
		await settle();
		item('Choose notes').click();
		await settle();

		expect(screen()).toContain('Pick the notes you mean');
		expect(() => button('Delete')).toThrow();

		onCanvas('1').click();
		await settle();
		expect(button('Delete')).toBeTruthy();
	});

	it('leaves the mode where the reader says so, by hand and by keyboard', async () => {
		await chooseThree();
		button('Done').click();
		await settle();
		expect(onCanvas('1').dataset.chosen).toBeUndefined();

		await chooseThree();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		await settle();
		expect(screen()).not.toContain('notes chosen');
	});

	// Escape reaches the page as well as the surface over it, and one keystroke
	// must not both put a question away and end what it was asked about.
	it('keeps the set while Escape is putting a surface away', async () => {
		await chooseThree();

		button('Tags').click();
		await settle();
		// Dispatched where a keystroke really lands, so the surface over the graph
		// reads it first and the page reads it after that surface has closed.
		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await settle();

		expect(screen()).toContain('3 notes chosen');
	});

	// The page reads Escape in the capture phase, which runs before the field the
	// reader typed into ever sees the key.
	it('leaves the set alone when Escape is emptying a field', async () => {
		api.on('GET /nodes/tags', () =>
			Array.from({ length: 20 }, (_, n) => ({ tag: `other${n}`, notes: 1 }))
		);
		await chooseThree();

		findTag('other1');
		await settle();
		expect(railChips()).not.toContain('other0');

		const field = document.body.querySelector<HTMLInputElement>('input[aria-label="Find a tag"]');
		field?.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
		);
		await settle();

		expect(field?.value).toBe('');
		expect(railChips()).toContain('other0');
		expect(screen()).toContain('3 notes chosen');
	});

	// Every surface over this page is the one modal, and a set of twenty is worth
	// more than the surface a glance opened over it.
	it('keeps the set for a surface it was never asked about', async () => {
		await chooseThree();

		labelled('Other ways to write').click();
		await settle();
		item('Number it yourself').click();
		await settle();
		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await settle();

		expect(screen()).toContain('3 notes chosen');
	});

	// DESIGN.md § "The mark": the orbit outside a mark carries the mode the canvas
	// is in, and a canvas is only ever in one of them. Choosing left running under
	// a picker would draw over the ring that says which note the link comes from.
	it('lets the set go when the canvas is asked to point at a note', async () => {
		const WRITTEN = ref(9);
		api.on('POST /nodes', () => node(9, '3'));
		api.on(`GET ${path(WRITTEN)}`, () => node(9, '3'));
		api.on(`GET ${path(WRITTEN)}/blocks`, () => []);

		await chooseThree();
		button('New branch').click();
		await settle();
		await pointFromNote();

		expect(screen()).toContain('Tap a note to link it to');
		expect(screen()).not.toContain('notes chosen');
		expect(onCanvas('1').dataset.chosen).toBeUndefined();
		expect(choosingOnCanvas()).toBeUndefined();
	});

	it('goes back to opening a note once nobody is choosing', async () => {
		await chooseThree();
		button('Done').click();
		await settle();

		onCanvas('1a').click();
		await settle();

		expect(screen()).toContain('Cells');
		expect(acts).toEqual([]);
	});
});

// The tag axis asks a question of the whole graph; this is what carries its
// answer over to the acts, which is the only bulk path a phone has.
describe('choosing the notes a selection lit', () => {
	function light(of: OwnedRef, ...carried: string[]): void {
		const note = graph.get(of);
		if (!note) throw new Error('No such note');
		graph.set(of, { ...note, tags: carried });
	}

	/** A graph of `many` root notes, every one of them carrying `seed`. */
	function installLit(many: number): void {
		const held = new Map<OwnedRef, NodeView>();
		for (let n = 1; n <= many; n += 1) held.set(ref(n), node(n, `${n}`, { tags: ['seed'] }));
		graph = held;
		api.on('GET /nodes/tags', () => [{ tag: 'seed', notes: many }]);
		api.on('GET /nodes', (url) => (url.searchParams.get('origin') ? [] : [...held.values()]));
	}

	it('offers the lit notes on the bare field, and hands the whole set to one act', async () => {
		light(SECOND, 'seed');
		light(THIRD, 'seed');
		tags.select(['seed']);
		await open();

		menuOn('the canvas').click();
		await settle();
		expect(offered()).toEqual([
			'Choose the 2 notes lit up',
			'New branch',
			'New note',
			'Choose notes'
		]);

		item('Choose the 2 notes lit up').click();
		await settle();
		expect(screen()).toContain('2 notes chosen');
		expect(onCanvas('1a').dataset.chosen).toBe('yes');
		expect(onCanvas('1').dataset.chosen).toBeUndefined();

		button('Tags').click();
		await settle();
		typeTag('seeds');
		await settle();

		expect(acts).toEqual([{ notes: [SECOND, THIRD], act: { act: 'tag', tags: ['seeds'] } }]);
	});

	it('offers nothing to choose while the selection lights no note', async () => {
		tags.select(['seed']);
		await open();

		menuOn('the canvas').click();
		await settle();

		expect(offered()).toEqual(['New branch', 'New note', 'Choose notes']);
	});

	it('counts one lit note as one', async () => {
		light(THIRD, 'seed');
		tags.select(['seed']);
		await open();

		menuOn('the canvas').click();
		await settle();

		expect(offered()).toEqual(['Choose the note lit up', 'New branch', 'New note', 'Choose notes']);
	});

	// The bound is the reader's to see before the tap: a refusal landing after it
	// would leave them in the mode with an act they cannot ask for.
	it('says how many of the lit notes one act reaches, before it is asked for', async () => {
		const many = MAX_NOTES_PER_BULK_ACT + 12;
		installLit(many);
		tags.select(['seed']);
		await open();

		const row = `Choose ${MAX_NOTES_PER_BULK_ACT.toLocaleString()} of the ${many.toLocaleString()} notes lit up`;
		menuOn('the canvas').click();
		await settle();
		expect(offered()).toEqual([row, 'New branch', 'New note', 'Choose notes']);

		item(row).click();
		await settle();

		expect(screen()).toContain(`${MAX_NOTES_PER_BULK_ACT.toLocaleString()} notes chosen`);
		expect(screen()).not.toContain('Choose fewer');
	});

	// The rail narrows what it draws, never what the canvas lit, so the row still
	// reaches the notes the reader can see are lit.
	it('still offers the lit notes while the rail is narrowed past the tag that lit them', async () => {
		light(SECOND, 'seed');
		light(THIRD, 'seed');
		api.on('GET /nodes/tags', () => [
			{ tag: 'seed', notes: 2 },
			...Array.from({ length: 20 }, (_, n) => ({ tag: `other${n}`, notes: 1 }))
		]);
		tags.select(['seed']);
		await open();

		findTag('other1');
		await settle();

		expect(railChips()).not.toContain('other0');
		expect(railChips()).toContain('seed');
		menuOn('the canvas').click();
		await settle();

		expect(offered()).toEqual([
			'Choose the 2 notes lit up',
			'New branch',
			'New note',
			'Choose notes'
		]);
	});
});

describe('a branch started from a shape', () => {
	const WRITTEN = ref(9);
	/** The note's stack as the server holds it. */
	let stack: BlockView[];

	function shape(named: string): HTMLButtonElement {
		const found = [...document.body.querySelectorAll<HTMLButtonElement>('li button')].find(
			(row) => row.querySelector('span')?.textContent?.trim() === named
		);
		if (!found) throw new Error(`No shape on screen is called "${named}"`);
		return found;
	}

	/** Real timers: what is being waited for is the note settling, not a delay. */
	async function until(ready: () => boolean): Promise<void> {
		for (let turn = 0; turn < 200 && !ready(); turn += 1) {
			await new Promise((wake) => setTimeout(wake));
			flushSync();
		}
		if (!ready()) throw new Error('The note never settled');
	}

	beforeEach(() => {
		stack = [];
		api.on('POST /nodes', () => node(9, '3'));
		api.on(`GET ${path(WRITTEN)}`, () => node(9, '3'));
		api.on(`GET ${path(WRITTEN)}/blocks`, () => stack);
		api.on('POST /blocks', (_url, init) => {
			const request = JSON.parse(String(init?.body)) as CreateBlockRequest;
			const row: BlockView = {
				ref: ref(20 + stack.length),
				created_by: DID,
				created_at: AT,
				updated_at: AT,
				node: request.node,
				ord: String(stack.length + 1).padStart(4, '0'),
				content: request.content as BlockView['content']
			};
			stack.push(row);
			return row;
		});
	});

	// The shape is handed to the note once. Back unmounts it and Forward mounts
	// it again from the same entry, so a shape still on offer would be taken twice.
	it('writes the sections once, however often the reader comes back to the note', async () => {
		await fromNothing();

		shape('Objection').click();
		await until(() => stack.length === 2);

		back();
		await settle();
		expect(reading()).toBe(false);

		forward();
		await until(() => reading());
		await settle();
		await settle();

		expect(stack).toHaveLength(2);
	});
});

// PRODUCT.md § Accessibility: a keyboard is a way of preferring the non-visual
// path, not a way of doing less on it.
describe('writing a note from the keyboard', () => {
	const WRITTEN = ref(9);
	let placed: unknown;

	function strike(shiftKey: boolean, from: Element = document.body): void {
		from.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'Enter',
				metaKey: true,
				shiftKey,
				bubbles: true,
				cancelable: true
			})
		);
	}

	/** A row of the one control at the head of the note being read. */
	async function fromTheNote(named: string): Promise<void> {
		labelled('What to do with this note').click();
		await settle();
		const row = [...document.body.querySelectorAll('button')].find(
			(one) => one.textContent?.trim() === named
		);
		if (!row) throw new Error(`The note's menu does not offer "${named}"`);
		row.click();
		await settle();
	}

	async function openNote(): Promise<void> {
		await open();
		onCanvas('1a').click();
		await settle();
	}

	beforeEach(() => {
		placed = undefined;
		api.on('POST /nodes', (_url, init) => {
			placed = (JSON.parse(String(init?.body)) as { from?: unknown }).from;
			return node(9, '3');
		});
		api.on(`GET ${path(WRITTEN)}`, () => node(9, '3'));
		api.on(`GET ${path(WRITTEN)}/blocks`, () => []);
	});

	it('starts a branch of its own', async () => {
		await open();
		strike(false);
		await settle();

		expect(placed).toEqual({ relation: 'branch', graph: expect.any(String) });
		expect(reading()).toBe(true);
	});

	it('continues the note being read', async () => {
		await openNote();

		strike(true);
		await settle();

		expect(placed).toEqual({ relation: 'under', note: SECOND });
	});

	it('leaves the keys alone while the graph is asking something', async () => {
		await open();
		menuOn('1a').click();
		await settle();
		item('Tags').click();
		await settle();
		expect(inSheet()).toContain('Tag this note');

		strike(false);
		await settle();

		expect(placed).toBeUndefined();
	});

	it('leaves the keys alone while the note being read is asking something', async () => {
		await openNote();
		labelled('What to do with this note').click();
		await settle();

		strike(false);
		await settle();

		expect(placed).toBeUndefined();
	});

	it('leaves the keys alone while the note is answering for what was asked', async () => {
		await openNote();
		await fromTheNote('Tags');
		expect(inSheet()).toContain('Tags');

		strike(false);
		await settle();

		expect(placed).toBeUndefined();
	});

	it('continues the note being read from inside its writing', async () => {
		await openNote();
		const writing = document.body.querySelector('.sloppy-prose');
		if (!writing) throw new Error('The note has no writing surface');

		strike(true, writing);
		await settle();

		expect(placed).toEqual({ relation: 'under', note: SECOND });
	});

	it('leaves the keys the writing answers to the writing', async () => {
		await openNote();
		const writing = document.body.querySelector('.sloppy-prose');
		if (!writing) throw new Error('The note has no writing surface');
		writing.addEventListener('keydown', (event) => event.preventDefault());

		strike(true, writing);
		await settle();

		expect(placed).toBeUndefined();
	});

	it('leaves the keys to the title they were typed into', async () => {
		await openNote();
		const name = document.body.querySelector('[aria-label="Title"]');
		if (!name) throw new Error('The note has no title');

		strike(false, name);
		await settle();

		expect(placed).toBeUndefined();
	});

	it('writes nothing where there is no note to continue', async () => {
		await open();
		strike(true);
		await settle();

		expect(placed).toBeUndefined();
	});

	it('names the keys on the control that writes the same note', async () => {
		await open();

		const branch = button('New branch');
		expect(branch.getAttribute('aria-keyshortcuts')).toContain('Enter');
		expect(branch.getAttribute('aria-label')).toMatch(/^New branch \(.+\)$/);
	});
});

// AI.md § "The Genealogy Is the Protocol": a note written with no parent and no
// address is an ordinary note, and it opens no branch.
describe('writing a note of its own', () => {
	const WRITTEN = ref(9);
	let placed: unknown;

	beforeEach(() => {
		placed = undefined;
		api.on('POST /nodes', (_url, init) => {
			placed = (JSON.parse(String(init?.body)) as { from?: unknown }).from;
			return unnumbered(9);
		});
		api.on(`GET ${path(WRITTEN)}`, () => unnumbered(9));
		api.on(`GET ${path(WRITTEN)}/blocks`, () => []);
	});

	it('asks for one from the chrome, and opens it to be written', async () => {
		await open();

		labelled('Other ways to write').click();
		await settle();
		item('A note on its own').click();
		await settle();

		expect(placed).toEqual({ relation: 'free', graph: expect.any(String) });
		expect(reading()).toBe(true);
	});

	it('asks for one from the menu on the bare canvas', async () => {
		await open();
		menuOn('the canvas').click();
		await settle();

		item('New note').click();
		await settle();

		expect(placed).toEqual({ relation: 'free', graph: expect.any(String) });
	});

	it('asks for one from the outline', async () => {
		await open();
		labelled('Walk the notes one at a time').click();
		await settle();

		button('New note').click();
		await settle();

		expect(placed).toEqual({ relation: 'free', graph: expect.any(String) });
	});
});

// PRODUCT.md § "Capture is one gesture": the four seconds belong to the product,
// not to the network, so the surface opens on the tap and the writing waits for
// the address rather than the other way round.
describe('a note written before the server has answered', () => {
	const WRITTEN = ref(9);
	let stalled: { answer: (value: NodeView | Response) => void };
	let created: CreateBlockRequest[];
	/** The title the note was given once it had an address, if it was given one. */
	let titled: string | undefined;

	function heldOpen(): {
		answer: (value: NodeView | Response) => void;
		route: () => Promise<NodeView | Response>;
	} {
		let give: (value: NodeView | Response) => void = () => {};
		const waiting = new Promise<NodeView | Response>((settle) => (give = settle));
		return { answer: (value) => give(value), route: () => waiting };
	}

	function field(label: string): HTMLTextAreaElement {
		const found = document.body.querySelector<HTMLTextAreaElement>(
			`textarea[aria-label="${label}"]`
		);
		if (!found) throw new Error(`No "${label}" field on screen`);
		return found;
	}

	function type(into: HTMLTextAreaElement, said: string): void {
		into.value = said;
		into.dispatchEvent(new Event('input', { bubbles: true }));
	}

	/** Real timers: what is waited for is the writing settling, on its own clock,
	 *  which is longer than a frame and shorter than this. */
	async function until(ready: () => boolean): Promise<void> {
		const stop = Date.now() + 4000;
		while (!ready() && Date.now() < stop) {
			await new Promise((wake) => setTimeout(wake, 10));
			flushSync();
		}
		if (!ready()) throw new Error('The writing never reached the note');
	}

	const said = (of: CreateBlockRequest): string =>
		((of.content?.content ?? []) as { content?: { text?: string }[] }[])
			.flatMap((paragraph) => (paragraph.content ?? []).map((run) => run.text ?? ''))
			.join('');

	beforeEach(() => {
		created = [];
		titled = undefined;
		const trip = heldOpen();
		stalled = trip;
		api.on('POST /nodes', () => trip.route());
		api.on(`GET ${path(WRITTEN)}`, () => node(9, '3'));
		api.on(`GET ${path(WRITTEN)}/blocks`, () => []);
		api.on(`PATCH ${path(WRITTEN)}`, (_url, init) => {
			const change = JSON.parse(String(init?.body)) as Partial<NodeView>;
			titled = change.title;
			return { ...node(9, '3'), ...change };
		});
		api.on('POST /blocks', (_url, init) => {
			const request = JSON.parse(String(init?.body)) as CreateBlockRequest;
			created.push(request);
			return {
				ref: ref(20 + created.length),
				created_by: DID,
				created_at: AT,
				updated_at: AT,
				node: request.node,
				ord: '0001',
				content: request.content
			};
		});
	});

	it('opens somewhere to write on the tap, with the address still being given', async () => {
		await open();
		button('New branch').click();
		await settle();

		expect(reading()).toBe(true);
		expect(screen()).toContain('Giving it an address');
		expect(document.body.querySelector('.address')).toBeNull();
	});

	// A note written on its own is given no address, so the surface it is written
	// on says what is happening rather than what is not.
	it('promises no address for a note written on its own', async () => {
		await open();
		labelled('Other ways to write').click();
		await settle();
		item('A note on its own').click();
		await settle();

		expect(reading()).toBe(true);
		expect(screen()).toContain('Putting it down');
		expect(screen()).not.toContain('Giving it an address');
	});

	it('puts what was typed into the note the moment there is one', async () => {
		await open();
		button('New branch').click();
		await settle();
		type(field('Title'), 'Membranes');
		type(field('Note body'), 'two bars is still four seconds');
		await settle();

		stalled.answer(node(9, '3'));
		await settle();

		expect(field('Title').value).toBe('Membranes');
		await until(() => created.length > 0);
		expect(created).toHaveLength(1);
		expect(created[0].node).toBe(WRITTEN);
		expect(said(created[0])).toBe('two bars is still four seconds');
		expect(titled).toBe('Membranes');
	});

	it('keeps the writing and offers another go when the note will not be written', async () => {
		await open();
		button('New branch').click();
		await settle();
		type(field('Note body'), 'two bars is still four seconds');
		await settle();

		stalled.answer(
			new Response('{"message":"That note would not go."}', {
				status: 400,
				headers: { 'content-type': 'application/json' }
			})
		);
		await settle();

		expect(screen()).toContain('That note would not go.');
		expect(field('Note body').value).toBe('two bars is still four seconds');

		api.on('POST /nodes', () => node(9, '3'));
		button('Try again').click();
		await settle();

		await until(() => created.length > 0);
		expect(said(created[0])).toBe('two bars is still four seconds');
	});

	function shape(named: string): HTMLButtonElement {
		const found = [...document.body.querySelectorAll<HTMLButtonElement>('li button')].find(
			(row) => row.querySelector('span')?.textContent?.trim() === named
		);
		if (!found) throw new Error(`No shape on screen is called "${named}"`);
		return found;
	}

	async function writeFromTheCanvas(): Promise<void> {
		await open();
		menuOn('1a').click();
		await settle();
		item('Write a note under this').click();
		await settle();
	}

	it('opens somewhere to write for a note asked for on the canvas, with nothing open', async () => {
		await writeFromTheCanvas();

		expect(reading()).toBe(true);
		expect(screen()).toContain('Giving it an address');
		expect(document.body.querySelector('.address')).toBeNull();
	});

	it('opens somewhere to write for a note asked for from a row of the outline', async () => {
		await open();
		labelled('Walk the notes one at a time').click();
		await settle();
		labelled('Unfold 1').click();
		await settle();
		labelled('Write a note under 1a').click();
		await settle();

		expect(reading()).toBe(true);
		expect(screen()).toContain('Giving it an address');
	});

	it('says a note asked for on the canvas would not go, and lets the writing be left', async () => {
		await writeFromTheCanvas();
		type(field('Note body'), 'two bars is still four seconds');
		await settle();

		stalled.answer(
			new Response('{"message":"That note would not go."}', {
				status: 400,
				headers: { 'content-type': 'application/json' }
			})
		);
		await settle();

		expect(screen()).toContain('That note would not go.');
		expect(field('Note body').value).toBe('two bars is still four seconds');

		button('Graph').click();
		await settle();

		expect(reading()).toBe(false);
		expect(button('New branch').disabled).toBe(false);
	});

	it('keeps what was typed into a branch started from a shape, above its sections', async () => {
		await fromNothing();
		shape('Objection').click();
		await settle();
		type(field('Note body'), 'two bars is still four seconds');
		await settle();

		stalled.answer(node(9, '3'));
		await until(() => created.length === 3);

		expect(created.map(said)).toEqual([
			'two bars is still four seconds',
			'The objection',
			'What survives if I am right'
		]);
	});

	it('hands what was typed back to the note when its sections will not go', async () => {
		api.on(
			'POST /blocks',
			() =>
				new Response('{"message":"That section would not go."}', {
					status: 400,
					headers: { 'content-type': 'application/json' }
				})
		);
		await fromNothing();
		shape('Objection').click();
		await settle();
		type(field('Note body'), 'two bars is still four seconds');
		await settle();

		stalled.answer(node(9, '3'));
		await settle();

		expect(screen()).toContain('That section would not go.');
		await until(() => screen().includes('two bars is still four seconds'));
	});

	/** Two notes on the strip, reading the second of them. */
	async function openTwo(): Promise<void> {
		stubViewport((query) => query.includes('900'));
		await open();
		onCanvas('1').click();
		await settle();
		menuOn('2').click();
		await settle();
		item('Open it as well').click();
		await settle();
	}

	/** The strip's addresses, in order, and which of them is being read. */
	function openTabs(): { addresses: string[]; reading: string | undefined } {
		const marks = [...(document.body.querySelectorAll('[aria-label="Open notes"] .address') ?? [])];
		return {
			addresses: marks.map((mark) => mark.textContent ?? ''),
			reading: marks.find((mark) => mark.closest('button')?.getAttribute('aria-current') === 'page')
				?.textContent
		};
	}

	function tab(address: string): HTMLButtonElement {
		const found = [
			...document.body.querySelectorAll<HTMLButtonElement>('[aria-label="Open notes"] button')
		].find((one) => one.querySelector('.address')?.textContent === address);
		if (!found) throw new Error(`No tab for ${address} is on the strip`);
		return found;
	}

	it('writes it in the tab of the note it was asked under', async () => {
		await openTwo();
		menuOn('1').click();
		await settle();
		item('Write a note under this').click();
		await settle();

		expect(screen()).toContain('Giving it an address');
		expect(openTabs()).toEqual({ addresses: ['1', '2'], reading: '1' });
	});

	it('lets the reader move to another note while the address is still coming', async () => {
		await openTwo();
		tab('1').click();
		await settle();
		button('Write a note under this').click();
		await settle();
		expect(openTabs()).toEqual({ addresses: ['1', '2'], reading: '1' });

		tab('2').click();
		await settle();

		expect(screen()).not.toContain('Giving it an address');
		expect(field('Title').value).toBe('Method');
		expect(openTabs()).toEqual({ addresses: ['1', '2'], reading: '2' });

		stalled.answer(node(9, '3'));
		await settle();

		expect(openTabs()).toEqual({ addresses: ['3', '2'], reading: '3' });
	});

	it('says the write controls are waiting in the note the reader steps onto', async () => {
		await openTwo();
		tab('1').click();
		await settle();
		button('Write a note under this').click();
		await settle();
		tab('2').click();
		await settle();

		expect(screen()).not.toContain('Giving it an address');
		expect(button('Write a note under this').disabled).toBe(true);
		expect(button('Write the next note').disabled).toBe(true);

		stalled.answer(node(9, '3'));
		await settle();

		expect(button('Write a note under this').disabled).toBe(false);
	});

	it('steps back onto the note when the tab it is being written in is tapped', async () => {
		await openTwo();
		tab('1').click();
		await settle();
		button('Write a note under this').click();
		await settle();
		expect(screen()).toContain('Giving it an address');

		tab('1').click();
		await settle();

		expect(screen()).not.toContain('Giving it an address');
		expect(field('Title').value).toBe('Origins');
		expect(openTabs()).toEqual({ addresses: ['1', '2'], reading: '1' });
	});

	it('marks no note as the one being read while a branch is being written', async () => {
		await openTwo();
		button('New branch').click();
		await settle();

		expect(screen()).toContain('Giving it an address');
		expect(openTabs().reading).toBeUndefined();
		expect(openTabs().addresses).toEqual(['1', '2']);
	});
});

// PRODUCT.md principle 7: ten thousand notes that stay readable. The canvas
// bounds what it draws; what the page asks for is bounded to match, so the field
// is on screen after one read whatever is under it.
describe('how much of a field is read before it draws', () => {
	const asksForBranches = () => api.calls.filter((call) => call.startsWith('GET /nodes?origin='));

	it('reads to the depth the canvas draws first, and the rest of the branch after', async () => {
		await open();

		const asked = asksForBranches();
		const bounded = asked.filter((call) => call.includes(`max_depth=${DEFAULT_BUDGET.depth + 1}`));
		const whole = asked.filter((call) => !call.includes('max_depth='));

		expect(bounded.length).toBeGreaterThan(0);
		expect(whole).toHaveLength(bounded.length);
		expect(asked.indexOf(bounded[0])).toBeLessThan(asked.indexOf(whole[0]));
	});

	it('draws the field before the whole of it has arrived', async () => {
		let arrive: (() => void) | undefined;
		const rest = new Promise<void>((done) => (arrive = done));
		api.on('GET /nodes', async (url) => {
			const origin = url.searchParams.get('origin');
			if (origin && !url.searchParams.get('max_depth')) await rest;
			return [...graph.values()].filter((n) => (origin ? n.origin === origin : n.ref === n.origin));
		});

		await open();
		expect(() => onCanvas('1')).not.toThrow();
		expect(screen()).not.toContain('could not be read');

		arrive?.();
		await settle();
	});
});

describe('the graph as this device last read it', () => {
	function nothingListening(): void {
		const refuse = () => {
			throw new Error('nothing is listening');
		};
		api.on('GET /nodes', refuse);
		api.on('GET /nodes/tags', refuse);
	}

	/** The cache waits out the answers before it writes, and every case here
	 *  turns on the device having what a first read left it. */
	async function written(): Promise<void> {
		await new Promise((done) => setTimeout(done, 250));
	}

	it('draws what this device kept when nothing can be reached, and says how old it may be', async () => {
		await open();
		expect(screen()).toContain('Origins');
		await written();

		nodes.clear();
		tags.clear();
		nothingListening();
		await open();

		expect(() => onCanvas('1')).not.toThrow();
		expect(screen()).toContain('This is your graph as you last read it.');
		expect(screen()).not.toContain('could not reach');
	});

	it('asks again from where the kept graph is drawn', async () => {
		await open();
		await written();
		nodes.clear();
		tags.clear();
		nothingListening();
		await open();
		expect(screen()).toContain('This is your graph as you last read it.');

		graph = installGraph();
		button('Try again').click();
		await settle();

		expect(screen()).not.toContain('This is your graph as you last read it.');
	});

	// The rail is the legend beside the graph, so its counts going missing is not
	// the graph going missing.
	it('draws what the server answered even where the tag counts would not read', async () => {
		api.on('GET /nodes/tags', () => {
			throw new Error('nothing is listening');
		});

		await open();

		expect(() => onCanvas('1')).not.toThrow();
		expect(screen()).not.toContain('This is your graph as you last read it.');
		expect(screen()).not.toContain('could not be read');
	});

	it('says notes are missing rather than calling the graph old, where some of it answered', async () => {
		api.on('GET /nodes', (url) => {
			if (url.searchParams.get('origin')) throw new Error('nothing is listening');
			return [...graph.values()].filter((one) => one.ref === one.origin);
		});

		await open();

		expect(() => onCanvas('1')).not.toThrow();
		expect(screen()).toContain('Some notes could not be read.');
		expect(screen()).not.toContain('This is your graph as you last read it.');
	});

	it('says the graph could not be reached where this device kept none of it', async () => {
		nodes.clear();
		nothingListening();

		await open();

		expect(screen()).toContain('Sloppy could not reach your graph');
		expect(screen()).not.toContain('This is your graph as you last read it.');
	});
});

describe('finding a note again from the graph', () => {
	/** Past the pause the writing inside notes is asked for after. */
	async function pause(): Promise<void> {
		await new Promise((done) => setTimeout(done, 260));
		await settle();
	}

	/** The rows the find sheet is offering, as a reader sees them. */
	const offering = (): string[] =>
		[...document.body.querySelectorAll<HTMLElement>('[role="dialog"] ul li button')].map((row) =>
			(row.textContent ?? '').replace(/\s+/g, ' ').trim()
		);

	async function lookFor(words: string): Promise<void> {
		await open();
		findControl().click();
		await settle();
		await typeToFind(words);
	}

	beforeEach(() => finding(api));

	afterEach(() => {
		prefs.set('alsoOnCanvas', []);
		graphs.clear();
	});

	it('opens from the key its control names, wherever the reader is', async () => {
		await open();
		expect(() => findField()).toThrow();

		window.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true })
		);
		await settle();

		expect(findControl().getAttribute('aria-keyshortcuts')).toBe('Meta+K Control+K');
		expect(document.activeElement).toBe(findField());
	});

	it('reaches a note by its number without waiting on anything', async () => {
		await lookFor('1a');

		expect(offering()).toEqual(['1a Cells']);
		expect(api.countOf('GET /nodes/search')).toBe(0);
	});

	it('opens the note a whole number resolves to when Enter is pressed', async () => {
		await lookFor('1a');

		findField().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await settle();

		expect(at.note).toBe(SECOND);
		expect(reading()).toBe(true);
	});

	it('opens the note whose row is tapped', async () => {
		await lookFor('method');

		const [row] = [
			...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] ul li button')
		];
		row.click();
		await settle();

		expect(at.note).toBe(THIRD);
	});

	it('brings in a note found by the words inside it once the typing stops', async () => {
		finding(api, { hits: [hit(graph.get(THIRD)!, { snippet: 'the bench it grew under' })] });
		await lookFor('bench');
		expect(offering()).toEqual([]);

		await pause();

		expect(offering()).toEqual(['2 Method the bench it grew under']);
	});

	it('says plainly when nothing matched', async () => {
		await lookFor('nothing like this');
		await pause();

		expect(inSheet()).toContain('Nothing on the canvas matches that.');
	});

	it('names no graph while one stands on the canvas', async () => {
		await lookFor('1a');

		expect(offering()[0]).not.toContain('·');
	});

	it('names the graph a note is in once a second one stands beside it', async () => {
		const GARDEN = ref(50);
		const COMPOST = node(51, '1', { title: 'Compost', graph: GARDEN });
		graph.set(COMPOST.ref, COMPOST);
		api.on('GET /graphs', () => [
			{ ref: homeGraphRef(DID), created_by: DID, created_at: AT, updated_at: AT, title: 'Notes' },
			{ ref: GARDEN, created_by: DID, created_at: AT, updated_at: AT, title: 'Garden' }
		]);

		await open();
		prefs.set('alsoOnCanvas', [GARDEN]);
		await settle();
		findControl().click();
		await settle();
		await typeToFind('compost');

		expect(offering()).toEqual(['1 Compost Garden']);
	});
});

// PRODUCT.md principle 3: an address is read inside one graph, so a strip that
// holds notes from two says which each one is in.
describe('which graph a tab is read in', () => {
	const GARDEN = ref(50);
	const COMPOST = node(51, '1', { title: 'Compost', graph: GARDEN });

	/** A note's own control on the stand-in canvas, by its title: two graphs on
	 *  one canvas can each hold a note at the same address. */
	function markTitled(title: string): HTMLButtonElement {
		const found = [...document.body.querySelectorAll('[aria-label="The graph"] button')].find(
			(mark) => mark.textContent?.includes(title)
		);
		if (!found) throw new Error(`No note titled ${title} is drawn`);
		return found as HTMLButtonElement;
	}

	function menuOnTitled(title: string): HTMLButtonElement {
		const row = markTitled(title).closest('li');
		const found = row?.querySelector<HTMLButtonElement>('[data-menu]');
		if (!found) throw new Error(`No menu answers on the note titled ${title}`);
		return found;
	}

	/** What each tab on the strip says, in the order the notes were opened. */
	const tabsSay = (): string[] =>
		[...document.body.querySelectorAll<HTMLElement>('[aria-label="Open notes"] button')]
			.filter((one) => one.querySelector('.address'))
			.map((one) => (one.textContent ?? '').replace(/\s+/g, ' ').trim());

	async function alsoShowGarden(): Promise<void> {
		graph.set(COMPOST.ref, COMPOST);
		api.on('GET /graphs', () => [
			{ ref: HOME, created_by: DID, created_at: AT, updated_at: AT, title: 'Notes' },
			{ ref: GARDEN, created_by: DID, created_at: AT, updated_at: AT, title: 'Garden' }
		]);
		await open();
		prefs.set('alsoOnCanvas', [GARDEN]);
		await settle();
	}

	afterEach(() => {
		prefs.set('alsoOnCanvas', []);
		graphs.clear();
	});

	it('names no graph while the open notes are all in one', async () => {
		await open();
		onCanvas('1a').click();
		await settle();
		menuOn('2').click();
		await settle();
		item('Open it as well').click();
		await settle();

		expect(tabsSay()).toEqual(['1a Cells', '2 Method']);
	});

	it('names each graph once the open notes span two of them', async () => {
		await alsoShowGarden();
		markTitled('Origins').click();
		await settle();
		menuOnTitled('Compost').click();
		await settle();
		item('Open it as well').click();
		await settle();

		expect(tabsSay()).toEqual(['1 Origins Notes', '1 Compost Garden']);
	});

	// Two tabs both reading `1` are told apart by nothing else a screen reader
	// reaches.
	it('says which graph in the labels that close and choose a tab', async () => {
		await alsoShowGarden();
		markTitled('Origins').click();
		await settle();
		menuOnTitled('Compost').click();
		await settle();
		item('Open it as well').click();
		await settle();

		expect(labelled('1 Compost, in Garden')).toBeTruthy();
		expect(labelled('Close 1 in Notes')).toBeTruthy();
		expect(labelled('Close 1 in Garden')).toBeTruthy();
	});

	it('leaves the note still open naming no graph once the other one is closed', async () => {
		api.on('GET /nodes/deleted', () => []);
		api.on(`DELETE /graphs/${segments(GARDEN)}`, () => undefined);
		await alsoShowGarden();
		markTitled('Origins').click();
		await settle();
		menuOnTitled('Compost').click();
		await settle();
		item('Open it as well').click();
		await settle();
		expect(tabsSay()).toEqual(['1 Origins Notes', '1 Compost Garden']);

		labelled('Your graphs').click();
		await settle();
		labelled('Close Garden').click();
		await settle();
		button('Close it').click();
		await settle();

		expect(tabsSay()).toEqual([]);
		expect(labelled('Copy the address 1')).toBeTruthy();
	});
});

describe('the way back out of a trail', () => {
	beforeEach(() => {
		vi.spyOn(globalThis.history, 'back').mockImplementation(() => {
			back();
			flushSync();
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('offers the graph at the head of the trail', async () => {
		await open();
		onCanvas('1a').click();
		await settle();

		expect(wayOut().textContent?.trim()).toBe('Graph');
	});

	it('walks back to the note the reader came from, a jump at a time', async () => {
		await open();
		onCanvas('1a').click();
		await settle();
		labelled('The note this one grew out of, 1').click();
		await settle();
		expect(screen()).toContain('Origins');

		expect(wayOut().textContent?.trim()).toBe('Back');
		wayOut().click();
		await settle();

		expect(screen()).toContain('Cells');
		expect(wayOut().textContent?.trim()).toBe('Graph');

		forward();
		await settle();

		expect(screen()).toContain('Origins');
		expect(wayOut().textContent?.trim()).toBe('Back');
	});

	it('closes the surface where the way back is the graph', async () => {
		await open();
		onCanvas('1a').click();
		await settle();

		wayOut().click();
		await settle();

		expect(reading()).toBe(false);
	});

	function light(of: OwnedRef): void {
		graph.set(of, { ...graph.get(of)!, tags: ['seed'] });
		api.on('GET /nodes/tags', () => [{ tag: 'seed', notes: 1 }]);
		tags.select(['seed']);
	}

	// An act on the whole set a selection lit can take the note the reader is
	// standing on, and the trail behind it has to survive that.
	it('walks back to the note it came from after the one being read was deleted', async () => {
		light(FIRST);
		await open();
		onCanvas('1a').click();
		await settle();
		labelled('The note this one grew out of, 1').click();
		await settle();

		menuOn('the canvas').click();
		await settle();
		item('Choose the note lit up').click();
		await settle();
		button('Delete').click();
		await settle();
		button('Delete it').click();
		await settle();
		expect(reading()).toBe(false);

		back();
		await settle();

		expect(screen()).toContain('Cells');
		expect(wayOut().textContent?.trim()).toBe('Graph');
	});

	// Nothing offers a walk back to a note that is no longer in the graph.
	it('offers the graph where the note behind went with the lit set', async () => {
		light(SECOND);
		await open();
		onCanvas('1a').click();
		await settle();
		labelled('The note this one grew out of, 1').click();
		await settle();
		expect(wayOut().textContent?.trim()).toBe('Back');

		menuOn('the canvas').click();
		await settle();
		item('Choose the note lit up').click();
		await settle();
		button('Delete').click();
		await settle();
		button('Delete it').click();
		await settle();

		expect(screen()).toContain('Origins');
		expect(wayOut().textContent?.trim()).toBe('Graph');
	});

	// The surface holds the only copy of what is typed into it, so it survives
	// the entry it went up on being replaced — but not the reader walking off it.
	it('takes the writing surface down with the entry it went up on', async () => {
		api.on('POST /nodes', () => {
			throw new Error('nothing is listening');
		});
		await open();
		onCanvas('1a').click();
		await settle();
		button('Write a note under this').click();
		await settle();
		expect(screen()).toContain('Sloppy could not add that note');

		back();
		await settle();

		expect(screen()).not.toContain('Sloppy could not add that note');
		expect(reading()).toBe(false);
	});
});

// A find is a jump across the graph, so the entry it goes up on is the only
// thing that can carry the reader back to what they were reading.
describe('walking back out of a note a find jumped to', () => {
	beforeEach(() => {
		finding(api);
		vi.spyOn(globalThis.history, 'back').mockImplementation(() => {
			back();
			flushSync();
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('comes back to the note the find was asked from', async () => {
		await open();
		onCanvas('1a').click();
		await settle();
		expect(screen()).toContain('Cells');

		findControl().click();
		await settle();
		await typeToFind('2');
		findField().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await settle();
		expect(at.note).toBe(THIRD);

		expect(wayOut().textContent?.trim()).toBe('Back');
		wayOut().click();
		await settle();

		expect(screen()).toContain('Cells');
		expect(wayOut().textContent?.trim()).toBe('Graph');
	});

	it('offers the graph where the find was asked from the canvas alone', async () => {
		await open();
		findControl().click();
		await settle();
		await typeToFind('2');
		findField().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await settle();

		expect(at.note).toBe(THIRD);
		expect(wayOut().textContent?.trim()).toBe('Graph');
	});
});

describe('the drawing over the canvas', () => {
	const stroke = (x: number) => ({ points: [{ x, y: 0, pressure: 0.5, t: 0 }], width: 2 });

	function act(says: string): HTMLElement {
		const found = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
			(item) => item.textContent?.includes(says)
		);
		if (!found) throw new Error(`Nothing on the drawing's menu says "${says}"`);
		return found;
	}

	it('gives the pen back once the canvas has stopped asking for a note', async () => {
		await startLinking();
		expect(inkingOnCanvas()).toBeUndefined();

		button('Never mind').click();
		await settle();

		expect(inkingOnCanvas()).toBe('yes');
	});

	it('says nothing while there is nothing drawn', async () => {
		await open();

		expect(() => labelled('Your drawing')).toThrow();
	});

	it('gives back the last stroke, and then the whole drawing', async () => {
		await open();
		canvasInk.add(HOME, stroke(1));
		canvasInk.add(HOME, stroke(2));
		flushSync();

		labelled('Your drawing').click();
		await settle();
		act('Undo the last stroke').click();
		await settle();
		expect(canvasInk.strokes(HOME)).toHaveLength(1);

		labelled('Your drawing').click();
		await settle();
		act('Rub the drawing out').click();
		await settle();

		expect(canvasInk.strokes(HOME)).toEqual([]);
		expect(() => labelled('Your drawing')).toThrow();
	});
});

// PRODUCT.md § "Accessibility & Inclusion": the outline is an equal of the
// canvas, so what the canvas can do it can do, and preferring it is a choice
// the app keeps.
describe('reading the graph as an outline', () => {
	async function walk(): Promise<void> {
		await open();
		labelled('Walk the notes one at a time').click();
		await settle();
	}

	/** What the outline holds its rows clear of at the bottom edge. */
	const foot = () =>
		document.body
			.querySelector('[role="tree"]')
			?.closest<HTMLElement>('[style*="padding-bottom"]')
			?.getAttribute('style') ?? '';

	/** What the bar of chosen notes has told the page it stands on. */
	const barTakes = () =>
		document.documentElement.style.getPropertyValue('--chosen-bar-inset-bottom');

	it('opens on the outline for a reader who was last there', async () => {
		prefs.set('walking', true);
		await open();

		expect(inOutline('1')).toBeTruthy();
		expect(labelled('Back to the graph')).toBeTruthy();
	});

	it('chooses notes from a row, and offers the same acts over them', async () => {
		await walk();
		button('Choose notes').click();
		await settle();

		inOutline('1').click();
		await settle();

		expect(inOutline('1').getAttribute('aria-checked')).toBe('true');
		expect(inOutline('1').textContent).toContain('Chosen');
		expect(screen()).toContain('1 note chosen');
		expect(button('Publish')).toBeTruthy();

		button('Done choosing').click();
		await settle();
		expect(inOutline('1').hasAttribute('aria-checked')).toBe(false);
	});

	it('keeps the last rows out from under the bar while somebody is choosing', async () => {
		await walk();
		expect(foot()).toContain('--chosen-bar-inset-bottom');
		expect(barTakes()).toBe('');

		button('Choose notes').click();
		await settle();
		expect(barTakes()).not.toBe('');

		button('Done choosing').click();
		await settle();
		expect(barTakes()).toBe('');
	});

	it('says which notes anyone with the address can read', async () => {
		graph.set(FIRST, { ...(graph.get(FIRST) as NodeView), published: true });
		await walk();

		expect(inOutline('1').textContent).toContain('Published');
		expect(inOutline('2').textContent).not.toContain('Published');
	});

	const WRITTEN = ref(9);

	/** Write a note under 1a from its row, and answer where it landed. */
	async function writeFromRow(): Promise<void> {
		const fresh = node(9, '1a1', { title: 'Mitosis', origin: FIRST, parent: SECOND });
		const found: { recent: NodeView[] } = { recent: [] };
		finding(api, found);
		api.on('POST /nodes', () => {
			graph.set(WRITTEN, fresh);
			found.recent = [fresh];
			return fresh;
		});
		api.on(`GET ${path(WRITTEN)}`, () => fresh);
		api.on(`GET ${path(WRITTEN)}/blocks`, () => []);

		await walk();
		expect(document.body.querySelector(`[data-row="lead:${WRITTEN}"]`)).toBeNull();

		labelled('Unfold 1').click();
		await settle();
		labelled('Write a note under 1a').click();
		await settle();
	}

	it('takes a note written from a row into what was last written', async () => {
		await writeFromRow();

		expect(document.body.querySelector(`[data-row="lead:${WRITTEN}"]`)).not.toBeNull();
	});

	it('says the address it gave a note written from a row', async () => {
		await writeFromRow();

		expect(said()).toContain('Your new note is 1a1.');
	});

	const pull = (type: string, x: number, y: number): PointerEvent => {
		const event = new Event(type, { bubbles: true, cancelable: true });
		Object.assign(event, { pointerId: 7, pointerType: 'mouse', button: 0, clientX: x, clientY: y });
		return event as PointerEvent;
	};

	/** The outline laid out — rows 44 tall, each row's words set in by how far
	 *  down it sits — so a drag over it can be aimed at one of them. */
	function lay(): HTMLElement[] {
		const items = [...document.body.querySelectorAll<HTMLElement>('[role="treeitem"]')];
		for (const [at, row] of items.entries()) {
			const level = Number(row.getAttribute('aria-level') ?? 1);
			Object.defineProperty(row, 'getBoundingClientRect', {
				configurable: true,
				value: () => ({ top: at * 44, bottom: at * 44 + 44, left: 0, right: 400 })
			});
			const words = row.querySelector('.address');
			if (!words) continue;
			Object.defineProperty(words, 'getBoundingClientRect', {
				configurable: true,
				value: () => ({ top: at * 44, bottom: at * 44 + 44, left: 10 + (level - 1) * 20 })
			});
		}
		return items;
	}

	/** Carry `from`'s write control onto `onto`, level with that row or past it. */
	function carry(from: string, onto: string, how: 'under' | 'beside'): void {
		const items = lay();
		const grip = inOutline(from).querySelector<HTMLElement>('[aria-label^="Write a note under"]');
		const target = inOutline(onto);
		const level = Number(target.getAttribute('aria-level') ?? 1);
		const left = 10 + (level - 1) * 20;
		const x = how === 'under' ? left + 40 : left + 2;
		const y = items.indexOf(target) * 44 + 20;
		grip?.dispatchEvent(pull('pointerdown', 300, 5));
		window.dispatchEvent(pull('pointermove', x, y));
		window.dispatchEvent(pull('pointerup', x, y));
	}

	/** Where the outline asked for the note to go, and what came back. */
	async function dragged(onto: string, how: 'under' | 'beside'): Promise<unknown> {
		const fresh = node(9, '1b', { title: 'Mitosis', origin: FIRST, parent: FIRST });
		let placed: unknown;
		finding(api, { recent: [] });
		api.on('POST /nodes', (_url, init) => {
			placed = (JSON.parse(String(init?.body)) as { from?: unknown }).from;
			return fresh;
		});
		api.on(`GET ${path(WRITTEN)}`, () => fresh);
		api.on(`GET ${path(WRITTEN)}/blocks`, () => []);

		await walk();
		labelled('Unfold 1').click();
		await settle();
		carry('1a', onto, how);
		await settle();
		return placed;
	}

	it('writes the note beside the row its control was dragged level with', async () => {
		expect(await dragged('1a', 'beside')).toEqual({ relation: 'after', note: SECOND });
	});

	it('writes the note under the row its control was dragged past', async () => {
		expect(await dragged('1', 'under')).toEqual({ relation: 'under', note: FIRST });
	});

	it('opens the note the drag wrote where it stands, so the reader can type at once', async () => {
		await dragged('1a', 'beside');

		expect(document.body.querySelector(`[data-interior="${WRITTEN}"]`)).not.toBeNull();
		expect(reading()).toBe(false);
	});

	// The outline is one surface: a note is read and written where it stands,
	// and the aside beside the canvas is the canvas's.
	it('never opens the aside from a row of the outline', async () => {
		await walk();
		inOutline('1').click();
		await settle();

		expect(reading()).toBe(false);
		expect(document.body.querySelector(`[data-interior="${FIRST}"]`)).not.toBeNull();
	});

	it('reaches the note’s own page from the row’s own act', async () => {
		await walk();
		labelled('Open the page of 1').click();
		await settle();

		expect(reading()).toBe(true);
		expect(readingName()).toContain('Origins');
		expect(labelled('Walk the notes one at a time')).toBeTruthy();
	});

	// The run at the head of the outline is the outline's own, so a row of it is
	// read where the note stands like any other.
	it('never opens the aside from the run of what was last written either', async () => {
		finding(api, { recent: [graph.get(SECOND) as NodeView] });
		await walk();

		const head = document.body.querySelector<HTMLElement>(`[data-row="lead:${SECOND}"]`);
		if (!head) throw new Error('The walk is not headed by what was last written');
		head.click();
		await settle();

		expect(reading()).toBe(false);
		expect(document.body.querySelector(`[data-interior="${SECOND}"]`)).not.toBeNull();
	});

	// AI.md § "The Genealogy Is the Protocol": the address is what a person cites
	// and a peer resolves, so it has to land somewhere for whoever follows it.
	it('opens a note reached by its address where it stands while the reader is walking', async () => {
		prefs.set('walking', true);
		startAt(`/n/${segments(FIRST)}`);
		await open();

		expect(document.body.querySelector(`[data-interior="${FIRST}"]`)).not.toBeNull();
		expect(reading()).toBe(false);
	});
});

// The sheet asks and the store forgets the graph; what only the page does is
// put the reader back where they started with nothing open onto a graph that
// is no longer drawn.
describe('closing a graph the reader is standing in', () => {
	const GARDEN = ref(40);
	const SEEDLING = ref(41);

	async function inTheGarden(): Promise<void> {
		graphs.clear();
		const seedling = node(41, '1', { title: 'Seedlings', graph: GARDEN });
		api.on('GET /graphs', () => [
			{ ref: HOME, created_by: DID, title: 'My graph', created_at: AT, updated_at: AT },
			{ ref: GARDEN, created_by: DID, title: 'The garden', created_at: AT, updated_at: AT }
		]);
		api.on('GET /nodes/deleted', () => []);
		api.on(`DELETE /graphs/${segments(GARDEN)}`, () => undefined);
		api.on(`GET ${path(SEEDLING)}`, () => seedling);
		api.on(`GET ${path(SEEDLING)}/blocks`, () => []);
		startAt(`/n/${segments(SEEDLING)}`);
		await open();
	}

	afterEach(() => {
		prefs.set('alsoOnCanvas', []);
		graphs.clear();
	});

	// Somebody who published nothing out of it has nothing to weigh, so the
	// sentence about what a peer keeps is not put in front of them.
	it('asks about closing it without naming a copy nobody has', async () => {
		await inTheGarden();

		labelled('Your graphs').click();
		await settle();
		labelled('Close The garden').click();
		await settle();

		const text = document.body.textContent ?? '';
		expect(text).toContain('they cannot be put back');
		expect(text).not.toContain('keeps their copy');
	});

	it('says what a peer keeps where a branch of that graph went out', async () => {
		held = [{ ...publication(10, SEEDLING, '1'), graph: GARDEN }];
		await inTheGarden();

		labelled('Your graphs').click();
		await settle();
		labelled('Close The garden').click();
		await settle();

		expect(document.body.textContent).toContain(
			'Whoever already has a branch you published from it keeps their copy'
		);
	});

	it('puts the reader back in the graph they started with, with nothing open', async () => {
		await inTheGarden();
		expect(graphs.current).toBe(GARDEN);
		expect(reading()).toBe(true);

		labelled('Your graphs').click();
		await settle();
		labelled('Close The garden').click();
		await settle();
		button('Close it').click();
		await settle();

		expect(graphs.current).toBe(HOME);
		expect(reading()).toBe(false);
	});
});

// A note nobody numbered opens no branch, so the chrome cannot count it as one
// — AI.md § "The Genealogy Is the Protocol".
describe('what the chrome says the canvas holds', () => {
	it('counts the branches, and the notes standing on their own beside them', async () => {
		const ALONE = ref(4);
		graph.set(ALONE, unnumbered(4, { title: 'On its own' }));

		await open();

		expect(screen()).toContain('4 notes, 2 branches and 1 on its own');
	});

	it('counts branches alone where every root carries an address', async () => {
		await open();

		expect(screen()).toContain('3 notes across 2 branches');
	});

	it('says only what stands on its own where nobody numbered a root', async () => {
		graph.clear();
		graph.set(ref(4), unnumbered(4, { title: 'On its own' }));
		graph.set(ref(5), unnumbered(5, { title: 'Beside it' }));

		await open();

		expect(screen()).toContain('2 notes, 2 on their own');
	});
});

// docs/ARCHITECTURE.md § "A graph on disk": the archive is the vault zipped,
// and an import says what it holds before any of it is written.
describe('a graph as a file', () => {
	const OSMOSIS: GraphView = {
		ref: ref(60),
		created_by: DID,
		created_at: AT,
		updated_at: AT,
		title: 'Osmosis'
	};

	function whatArrives(over: Partial<ArchivePreview> = {}): ArchivePreview {
		return {
			format: 1,
			graph: '01JRZ0000000000000000000AA',
			name: 'Osmosis',
			owner: DID,
			notes: 12,
			pictures: 3,
			missing_emoji: [],
			collisions: [],
			replaces: false,
			replacing: 0,
			...over
		};
	}

	function takenAs(filename: string): FakeArchive['exported'] {
		return {
			[HOME]: () => ({ body: 'a graph', filename })
		};
	}

	/** Hand the picker a file, the way a person's file browser does. */
	function chooseFile(): void {
		const input = document.body.querySelector<HTMLInputElement>(
			'input[type="file"][accept=".sloppy"]'
		);
		if (!input) throw new Error('Nothing on screen takes a graph in');
		Object.defineProperty(input, 'files', {
			configurable: true,
			value: [new File([new Uint8Array([1, 2, 3])], 'osmosis.sloppy')]
		});
		input.dispatchEvent(new Event('change', { bubbles: true }));
	}

	async function fromMore(offer: string): Promise<void> {
		await open();
		labelled('More').click();
		await settle();
		item(offer).click();
		await settle();
	}

	afterEach(() => {
		graphs.clear();
	});

	it('offers to export this graph and to bring one in', async () => {
		await open();
		labelled('More').click();
		await settle();

		expect(offered()).toContain('Export this graph');
		expect(offered()).toContain('Import a graph');
	});

	it('takes a graph in from the empty graph, where there is nothing else to open a menu on', async () => {
		archiving(api, { preview: () => whatArrives() });
		api.on('GET /nodes', () => []);

		await open();
		button('Import a graph').click();
		await settle();
		chooseFile();
		await settle();

		expect(screen()).toContain('Import “Osmosis”?');
	});

	it('says where a copy can be taken on a shell that hands over no files', async () => {
		archiving(api, { exported: takenAs('Cell Biology 2026-03-05.sloppy') });
		initRuntime({ apiHost: () => 'http://api.test', saveFile: null });

		await fromMore('Export this graph');

		expect(screen()).toContain('Open Sloppy in a browser to take one.');
	});

	it('hands the graph over under the name it came back named', async () => {
		const saved: { name: string; body: Blob }[] = [];
		archiving(api, { exported: takenAs('Cell Biology 2026-03-05.sloppy') });
		initRuntime({
			apiHost: () => 'http://api.test',
			saveFile: async (name, body) => void saved.push({ name, body })
		});

		await fromMore('Export this graph');

		expect(saved.map((one) => one.name)).toEqual(['Cell Biology 2026-03-05.sloppy']);
		expect(await saved[0].body.text()).toBe('a graph');
	});

	// The web shell leaves the seam alone, and the browser saves it.
	it('is saved by the browser where the shell has no saving of its own', async () => {
		const asked: { href: string; name: string }[] = [];
		const clicking = HTMLAnchorElement.prototype.click;
		HTMLAnchorElement.prototype.click = function () {
			asked.push({ href: this.href, name: this.download });
		};
		URL.createObjectURL = () => 'blob:a-graph';
		URL.revokeObjectURL = () => {};
		archiving(api, { exported: takenAs('Cell Biology 2026-03-05.sloppy') });
		initRuntime({ apiHost: () => 'http://api.test', saveFile: undefined });

		await fromMore('Export this graph');
		HTMLAnchorElement.prototype.click = clicking;

		expect(asked).toEqual([{ href: 'blob:a-graph', name: 'Cell Biology 2026-03-05.sloppy' }]);
	});

	it('says what to do where the graph could not be put in a file', async () => {
		archiving(api, {
			exported: { [HOME]: () => refuses('Sloppy could not reach your writing.', 503) }
		});
		initRuntime({ apiHost: () => 'http://api.test', saveFile: undefined });

		await fromMore('Export this graph');

		expect(screen()).toContain('Sloppy could not reach your writing.');
	});

	it('says what is in a file before any of it is brought in', async () => {
		archiving(api, { preview: () => whatArrives(), imported: () => OSMOSIS });

		await fromMore('Import a graph');
		chooseFile();
		await settle();

		expect(screen()).toContain('Import “Osmosis”?');
		expect(screen()).toContain('12 notes and 3 pictures arrive.');
		expect(api.calls.filter((one) => one.startsWith('POST /graphs/import'))).toEqual([
			'POST /graphs/import?preview=1'
		]);
	});

	it('opens the graph it brought in', async () => {
		archiving(api, { preview: () => whatArrives(), imported: () => OSMOSIS });

		await fromMore('Import a graph');
		chooseFile();
		await settle();
		button('Import').click();
		await settle();

		expect(graphs.current).toBe(OSMOSIS.ref);
		expect(graphs.all.map((one) => one.ref)).toContain(OSMOSIS.ref);
		expect(screen()).not.toContain('Import “Osmosis”?');
	});

	it('repeats the words an import came back refused with, and opens nothing', async () => {
		archiving(api, {
			preview: () => whatArrives(),
			imported: () => refuses('Some of these notes are already here.')
		});

		await fromMore('Import a graph');
		chooseFile();
		await settle();
		button('Import').click();
		await settle();

		expect(screen()).toContain('Some of these notes are already here.');
		expect(graphs.current).toBe(HOME);
	});

	it('repeats the words a file that could not be read came back with', async () => {
		archiving(api, { preview: () => refuses("This file isn't a Sloppy graph.") });

		await fromMore('Import a graph');
		chooseFile();
		await settle();

		expect(screen()).toContain("This file isn't a Sloppy graph.");
		expect(screen()).not.toContain('Import “Osmosis”?');
	});
});
