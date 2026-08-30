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
			return at.note ? { note: at.note } : {};
		}
	}
}));

vi.mock('$app/navigation', () => ({
	pushState: (path: string, state: { note?: OwnedRef }) => pushed(path, state.note ?? null),
	replaceState: (path: string, state: { note?: OwnedRef }) => replaced(path, state.note ?? null),
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

const screen = () => document.body.textContent ?? '';

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

// DESIGN.md § "The mark" keeps the word "chosen" for the notes somebody picked
// out to act on; a selection is already the reader's tags.
describe('choosing several notes to act on', () => {
	let acts: NodeBulkRequest[];

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

	/** `1` through the menu, then `1a` and `2` by tapping, which is the phone's
	 *  way: the mode is entered by name and then taps add to it. */
	async function chooseThree(): Promise<void> {
		await open();
		menuOn('1').click();
		await settle();
		item('Choose this note').click();
		await settle();
		onCanvas('1a').click();
		onCanvas('2').click();
		await settle();
	}

	beforeEach(() => {
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
	});

	it('counts what is chosen and marks it on the canvas', async () => {
		await chooseThree();

		expect(screen()).toContain('3 notes chosen');
		expect(onCanvas('1').dataset.chosen).toBe('yes');
		expect(onCanvas('1a').dataset.chosen).toBe('yes');
	});

	it('offers different acts on a note and on the bare field', async () => {
		await open();
		menuOn('1').click();
		await settle();
		expect(offered()).toEqual(['Choose this note', 'Fold what is under this']);

		item('Choose this note').click();
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

	// The one act that cannot be taken back, and the one consequence a person
	// carries afterwards: the address stays where it was.
	it('asks before deleting, and says what a delete costs', async () => {
		await open();
		menuOn('1a').click();
		await settle();
		item('Choose this note').click();
		await settle();

		button('Delete').click();
		await settle();
		expect(screen()).toContain('Delete this note?');
		expect(screen()).toContain('no other note is renumbered');
		expect(acts).toEqual([]);

		button('Delete it').click();
		await settle();

		expect(acts).toEqual([{ notes: [SECOND], act: { act: 'delete' } }]);
		expect(graph.has(SECOND)).toBe(false);
		expect(screen()).not.toContain('chosen');
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

	function labelled(label: string): HTMLButtonElement {
		const found = [...document.body.querySelectorAll('button')].find(
			(b) => b.getAttribute('aria-label') === label
		);
		if (!found) throw new Error(`Nothing on screen is labelled "${label}"`);
		return found;
	}

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
