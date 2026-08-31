import type {
	BlockView,
	CreateBlockRequest,
	NodeBulkRequest,
	NodeView,
	OwnedRef
} from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AT, DID, node, ref, useFakeApi, type FakeApi } from '../stores/fake-api.test-support.js';
import { nodes } from '../stores/nodes.svelte.js';
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

const FIRST = ref(1);
const SECOND = ref(2);
const THIRD = ref(3);

let api: FakeApi;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let graph: Map<OwnedRef, NodeView>;
/** Every act the server was asked for, in the order it was asked. */
let acts: NodeBulkRequest[];

function path(of: OwnedRef): string {
	const cut = of.lastIndexOf('/');
	return `/nodes/${encodeURIComponent(of.slice(0, cut))}/${encodeURIComponent(of.slice(cut + 1))}`;
}

function stubViewport(): void {
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
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

/** Where the canvas has been told the reader is looking. */
const looking = () =>
	document.body.querySelector<HTMLElement>('[aria-label="The graph"]')?.dataset.focus;

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
	mounted = mount(Graph, { target });
	flushSync();
	await settle();
}

/** Open `1a` and ask for the note it links to to be picked on the graph. */
async function startLinking(): Promise<void> {
	await open();
	onCanvas('1a').click();
	await settle();
	button('Link to another note').click();
	await settle();
}

beforeEach(() => {
	startAt('/');
	stubViewport();
	nodes.clear();
	tags.clear();
	api = useFakeApi();
	graph = installGraph();
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
			const after: NodeView =
				act.act === 'tag'
					? { ...note, tags: [...new Set([...note.tags, ...act.tags])] }
					: act.act === 'untag'
						? { ...note, tags: note.tags.filter((tag) => !act.tags.includes(tag)) }
						: { ...note, appearance: act.appearance ?? undefined };
			graph.set(after.ref, after);
			return after;
		});
		return { reached: notes.length, missed: 0, notes };
	});
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	session.clear();
	target.remove();
	document.body.innerHTML = '';
});

describe('linking by pointing at the graph', () => {
	it('puts the graph forward, saying which note the choice is for', async () => {
		await startLinking();

		expect(screen()).toContain('Tap a note to link it to');
		expect(screen()).toContain('1a');
		// The note steps aside: on a phone the choice is the whole screen.
		expect(screen()).not.toContain('Link to another note');
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
		expect(screen()).toContain('Link to another note');
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
		expect(screen()).toContain('Link to another note');
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
			'Tags',
			'Give it a look',
			'Fold what is under this',
			'Choose this and others',
			'Delete it'
		]);
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

	// The one act that cannot be taken back, in the words the rest of the product
	// asks it in — never a second wording for the same question.
	it('asks before deleting it, counting what goes with it', async () => {
		await askAbout('1');

		item('Delete it').click();
		await settle();
		expect(screen()).toContain('Delete this note?');
		expect(screen()).toContain('It goes for good, and so does the one note that grew out of it.');
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
	/** `1` through the menu, which is the phone's way in. */
	async function chooseOne(): Promise<void> {
		await open();
		menuOn('1').click();
		await settle();
		item('Choose this and others').click();
		await settle();
	}

	/** Then `1a` and `2` by tapping: the mode is entered by name and then taps
	 *  add to it. */
	async function chooseThree(): Promise<void> {
		await chooseOne();
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
		expect(offered()).toEqual(['Choose notes']);

		item('Choose notes').click();
		await settle();
		onCanvas('1').click();
		await settle();
		menuOn('the canvas').click();
		await settle();
		expect(offered()).toEqual(['Tags', 'Give them a look', 'Delete it', 'Done choosing']);
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
		await chooseOne();

		button('Tags').click();
		await settle();

		expect(inSheet()).toContain('Tag this note');
		expect(inSheet()).toContain('Anything you add goes on this note');
	});

	it('offers a look to one chosen note in the singular', async () => {
		await chooseOne();

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

		button('Large').click();
		await settle();
		expect(button('Give them this look').disabled).toBe(false);

		button('Give them this look').click();
		await settle();
		expect(acts).toEqual([
			{
				notes: [FIRST, SECOND, THIRD],
				act: { act: 'set_appearance', appearance: { mark_radius: 'large' } }
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

	// The one act that cannot be taken back, so the question counts everything
	// that goes — the notes chosen are never all of them.
	it('asks before deleting, counting what goes with the notes chosen', async () => {
		await chooseOne();

		button('Delete').click();
		await settle();
		expect(screen()).toContain('Delete this note?');
		expect(screen()).toContain('It goes for good, and so does the one note that grew out of it.');
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
		expect(screen()).toContain('They go for good.');
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

	// DESIGN.md § Layout: a component renders only when it has something to do,
	// and choosing by name lands somebody here before they have chosen anything.
	it('offers no act until something is chosen', async () => {
		await open();
		menuOn('the canvas').click();
		await settle();
		item('Choose notes').click();
		await settle();

		expect(screen()).toContain('Tap the notes you mean');
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

	// Every surface over this page is the one modal, and a set of twenty is worth
	// more than the surface a glance opened over it.
	it('keeps the set for a surface it was never asked about', async () => {
		await chooseThree();

		labelled('A new branch, from a shape').click();
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
		button('Link to another note').click();
		await settle();

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
		mounted = mount(Graph, { target });
		flushSync();
		await settle();

		labelled('A new branch, from a shape').click();
		await settle();
		shape('Objection').click();
		await until(() => stack.length === 2);

		back();
		await settle();
		expect(screen()).not.toContain('Delete this note');

		forward();
		await until(() => screen().includes('Delete this note'));
		await settle();
		await settle();

		expect(stack).toHaveLength(2);
	});
});
