import type {
	BlockView,
	CreateBlockRequest,
	DocumentNode,
	NodeView,
	OwnedRef
} from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nodes } from '../stores/nodes.svelte.js';
import { session } from '../stores/session.svelte.js';
import {
	AT,
	DID,
	node,
	ref,
	useFakeApi,
	VIEWER,
	type FakeApi
} from '../stores/fake-api.test-support.js';
import NoteInModal from './note-in-modal.test-support.svelte';

const FIRST = ref(1);
const SECOND = ref(2);
const THIRD = ref(3);
const FOURTH = ref(4);
const FIFTH = ref(5);
const SIXTH = ref(6);

const PHONE = () => true;
const WIDE = () => false;

function path(of: OwnedRef): string {
	const cut = of.lastIndexOf('/');
	return `/nodes/${encodeURIComponent(of.slice(0, cut))}/${encodeURIComponent(of.slice(cut + 1))}`;
}

function stubViewport(matches: () => boolean): void {
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: () => ({
			matches: matches(),
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

/** Past the frame the modal claims focus on, and the one the caret follows in. */
async function settle(): Promise<void> {
	for (let frame = 0; frame < 4; frame += 1) await new Promise(requestAnimationFrame);
}

const focused = () => document.activeElement as HTMLElement | null;
const title = () => document.body.querySelector<HTMLTextAreaElement>('[aria-label="Title"]');

function button(labelled: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].find((b) =>
		b.textContent?.includes(labelled)
	);
	if (!found) throw new Error(`No "${labelled}" button on screen`);
	return found;
}

let api: FakeApi;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

beforeEach(() => {
	nodes.clear();
	api = useFakeApi();
	const written = [node(1, '1'), node(2, '1a', { origin: FIRST, parent: FIRST })];
	api.on('POST /nodes', () => written.shift());
	for (const of of [FIRST, SECOND]) {
		api.on(`GET ${path(of)}`, () => node(of === FIRST ? 1 : 2, of === FIRST ? '1' : '1a'));
		api.on(`GET ${path(of)}/blocks`, () => []);
	}
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

async function openWritten(at: () => boolean): Promise<OwnedRef> {
	stubViewport(at);
	const written = await nodes.create({});
	mounted = mount(NoteInModal, { target, props: { opened: written.ref } });
	flushSync();
	await settle();
	return written.ref;
}

describe.each([
	['on a phone', PHONE],
	['at desktop width', WIDE]
])('a note just written, %s', (_where, at) => {
	it('opens with the caret in its title', async () => {
		await openWritten(at);
		expect(focused()).toBe(title());
	});

	it('hands the caret on to the next note written from inside it', async () => {
		await openWritten(at);

		const write = button('A note under this');
		write.focus();
		write.click();
		await settle();

		expect(focused()).toBe(title());
		expect(title()?.value).toBe('');
	});
});

describe('a note opened to read', () => {
	it('keeps the caret out of its title', async () => {
		stubViewport(PHONE);
		await nodes.create({});
		mounted = mount(NoteInModal, { target, props: { opened: FIRST, fresh: false } });
		flushSync();
		await settle();

		expect(title()).not.toBeNull();
		expect(focused()).not.toBe(title());
	});

	it('does not call writing it could not read nothing at all', async () => {
		stubViewport(WIDE);
		await nodes.create({});
		api.on(`GET ${path(FIRST)}/blocks`, () => {
			throw new Error('unreachable');
		});

		mounted = mount(NoteInModal, { target, props: { opened: FIRST, fresh: false } });
		flushSync();
		await settle();

		expect(document.body.textContent).toContain('Close it and open it again');
		expect(document.body.textContent).not.toContain('Nothing written here yet');
	});
});

describe('what a note is written with', () => {
	function labelled(label: string): HTMLButtonElement | undefined {
		return [...document.body.querySelectorAll('button')].find(
			(b) => b.getAttribute('aria-label') === label
		);
	}

	async function openToWrite(): Promise<void> {
		stubViewport(WIDE);
		session.adopt(VIEWER, 'a-session');
		await nodes.create({});
		mounted = mount(NoteInModal, { target, props: { opened: FIRST, fresh: false } });
		flushSync();
		await settle();
		document.body
			.querySelector('.sloppy-prose')
			?.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
		flushSync();
	}

	it('offers a picture, and what the person already has', async () => {
		api.on('GET /media/uploads', () => [
			{ upload_id: `${DID}/01OLD`, filename: 'kite.png', mime_type: 'image/png', size: 9 }
		]);
		await openToWrite();

		labelled('Picture')?.click();
		flushSync();
		await settle();
		flushSync();

		expect(document.body.querySelector('input[type="file"]')).not.toBeNull();
		expect(labelled('kite.png')).toBeDefined();
	});

	it('offers the emoji this person uploaded, not only the Unicode set', async () => {
		api.on('GET /emoji/me', () => [
			{ emoji_id: `${DID}/01E`, did: DID, shortcode: 'parrot', kind: 'emoji', src: '/proxy?ref=p' }
		]);
		await openToWrite();

		labelled('Emoji')?.click();
		flushSync();
		await settle();
		flushSync();

		expect(document.body.textContent).toContain('Yours');
		expect(labelled('parrot')).toBeDefined();
	});
});

/**
 * A graph the note page can search, count and link across: two branches, one of
 * them two deep. The map IS the server's copy, so what a test asserts about it
 * is what actually crossed the wire.
 */
function installGraph(): Map<OwnedRef, NodeView> {
	const graph = new Map<OwnedRef, NodeView>([
		[FIRST, node(1, '1', { title: 'Origins' })],
		[SECOND, node(2, '1a', { title: 'Cells', origin: FIRST, parent: FIRST })],
		[THIRD, node(3, '1a1', { title: 'Membranes', origin: FIRST, parent: SECOND })],
		[FOURTH, node(4, '2', { title: 'Method' })]
	]);
	api.on('GET /nodes', (url) => {
		const origin = url.searchParams.get('origin');
		return [...graph.values()].filter((n) => (origin ? n.origin === origin : n.ref === n.origin));
	});
	for (const of of [FIRST, SECOND, THIRD, FOURTH]) {
		api.on(`GET ${path(of)}`, () => graph.get(of) ?? null);
		api.on(`GET ${path(of)}/blocks`, () => []);
		api.on(`PATCH ${path(of)}`, (_url, init) => {
			const before = graph.get(of);
			if (!before) return null;
			const after = { ...before, ...(JSON.parse(String(init?.body)) as Partial<NodeView>) };
			graph.set(of, after);
			return after;
		});
		api.on(`DELETE ${path(of)}`, () => {
			for (const [key, held] of graph) {
				if (key === of || held.parent === of) graph.delete(key);
			}
			return undefined;
		});
	}
	return graph;
}

/** What graph.svelte asks for on mount, which is what fills the cache. */
async function loadGraph(): Promise<void> {
	await nodes.load();
	await Promise.all([nodes.load({ origin: FIRST }), nodes.load({ origin: FOURTH })]);
}

async function openNote(
	at: OwnedRef,
	handlers: { onclose?: () => void; onlink?: () => void } = {}
): Promise<void> {
	stubViewport(WIDE);
	mounted = mount(NoteInModal, { target, props: { opened: at, fresh: false, ...handlers } });
	flushSync();
	await settle();
}

function labelled(label: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].find(
		(b) => b.getAttribute('aria-label') === label
	);
	if (!found) throw new Error(`Nothing on screen is labelled "${label}"`);
	return found;
}

function exactly(text: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].find(
		(b) => b.textContent?.trim() === text
	);
	if (!found) throw new Error(`No button on screen reads exactly "${text}"`);
	return found;
}

/** A row in one of the note's lists, by the title it shows. */
function noteRow(shows: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].find(
		(b) => b.querySelector('.address') && b.textContent?.includes(shows)
	);
	if (!found) throw new Error(`No note row on screen shows "${shows}"`);
	return found;
}

const screen = () => document.body.textContent ?? '';

/** Only what the typed field turned up: the note's own lists must not answer
 *  for it. */
const offered = () =>
	[...document.body.querySelectorAll('[aria-label="Notes to link to"] button')]
		.map((row) => row.textContent ?? '')
		.join(' ');

async function findToLink(typed: string): Promise<void> {
	const field = document.body.querySelector<HTMLInputElement>(
		'[aria-label="Link by title or address"]'
	);
	if (!field) throw new Error('The note has no field to cite a note into');
	field.value = typed;
	field.dispatchEvent(new Event('input', { bubbles: true }));
	await settle();
}

describe('deleting a note', () => {
	beforeEach(async () => {
		installGraph();
		await loadGraph();
	});

	it('says how much goes with it, counting the whole subtree', async () => {
		await openNote(FIRST);
		button('Delete this note').click();
		await settle();

		expect(screen()).toContain('Delete this note?');
		expect(screen()).toContain('It goes for good, and so do the 2 notes that grew out of it.');
	});

	it('counts one note as one note', async () => {
		await openNote(SECOND);
		button('Delete this note').click();
		await settle();

		expect(screen()).toContain('It goes for good, and so does the one note that grew out of it.');
	});

	it('promises nothing extra where nothing grew out of it', async () => {
		await openNote(THIRD);
		button('Delete this note').click();
		await settle();

		expect(screen()).toContain('It goes for good.');
		expect(screen()).not.toContain('grew out of it');
	});

	it('will not name a number before the branch it would count is here', async () => {
		nodes.clear();
		await nodes.load();
		await openNote(FIRST);
		button('Delete this note').click();
		await settle();

		expect(screen()).toContain('It goes for good, and so does everything written under it.');
	});

	it('leaves the reader on the note this one grew out of', async () => {
		const graph = installGraph();
		await openNote(THIRD);
		button('Delete this note').click();
		await settle();
		exactly('Delete').click();
		await settle();
		await settle();

		expect(graph.has(THIRD)).toBe(false);
		expect(document.body.querySelector('.address')?.textContent).toBe('1a');
		expect(title()?.value).toBe('Cells');
	});

	it('closes the note where there is nothing above it', async () => {
		const closed = vi.fn();
		await openNote(FIRST, { onclose: closed });
		button('Delete this note').click();
		await settle();
		exactly('Delete').click();
		await settle();
		await settle();

		expect(closed).toHaveBeenCalled();
	});
});

describe('writing the note that comes next', () => {
	let placed: unknown;

	beforeEach(async () => {
		installGraph();
		await loadGraph();
		placed = undefined;
		api.on('POST /nodes', (_url, init) => {
			placed = (JSON.parse(String(init?.body)) as { from?: unknown }).from;
			return node(9, '1b', { origin: FIRST, parent: FIRST });
		});
	});

	it('springs a note out of the one being read', async () => {
		await openNote(SECOND);
		button('A note under this').click();
		await settle();

		expect(placed).toEqual({ relation: 'under', note: SECOND });
	});

	it('continues the run the one being read is in', async () => {
		await openNote(SECOND);
		button('The next note').click();
		await settle();

		expect(placed).toEqual({ relation: 'after', note: SECOND });
	});
});

describe('linking a note to another', () => {
	let graph: Map<OwnedRef, NodeView>;

	beforeEach(async () => {
		graph = installGraph();
		await loadGraph();
	});

	it('finds the far note by the address a person would cite', async () => {
		await openNote(SECOND);
		await findToLink('2');
		noteRow('Method').click();
		await settle();
		await settle();

		expect(graph.get(SECOND)?.links).toEqual([FOURTH]);
		expect(screen()).toContain('Links to');
	});

	it('finds the far note by its title', async () => {
		await openNote(SECOND);
		await findToLink('meth');
		noteRow('Method').click();
		await settle();
		await settle();

		expect(graph.get(SECOND)?.links).toEqual([FOURTH]);
	});

	it('offers neither this note nor one it already points at', async () => {
		graph.set(SECOND, { ...graph.get(SECOND)!, links: [FOURTH] });
		nodes.clear();
		await loadGraph();
		await openNote(SECOND);
		// "Cells", "Method" and "Membranes" all match; only the exclusions thin it.
		await findToLink('e');

		expect(offered()).toContain('Membranes');
		expect(offered()).not.toContain('Method');
		expect(offered()).not.toContain('Cells');
	});

	it('is still there when the note is read again from scratch', async () => {
		await openNote(SECOND);
		await findToLink('meth');
		noteRow('Method').click();
		await settle();
		await settle();

		unmount(mounted!, { outro: false });
		mounted = undefined;
		nodes.clear();
		await loadGraph();
		await openNote(SECOND);

		expect(screen()).toContain('Links to');
		expect(noteRow('Method')).toBeTruthy();
	});

	// The graph is the picker, and it lives a layer up: the note asks for it and
	// steps aside.
	it('hands the choice to the graph when the reader would rather point at it', async () => {
		let asked = 0;
		await openNote(SECOND, { onlink: () => (asked += 1) });

		button('Link to another note').click();
		await settle();

		expect(asked).toBe(1);
	});

	it('tells the far note where the link came from', async () => {
		graph.set(SECOND, { ...graph.get(SECOND)!, links: [FOURTH] });
		nodes.clear();
		await loadGraph();
		await openNote(FOURTH);

		expect(screen()).toContain('Linked from');
		expect(noteRow('Cells')).toBeTruthy();
	});

	it('takes a link off again', async () => {
		graph.set(SECOND, { ...graph.get(SECOND)!, links: [FOURTH] });
		nodes.clear();
		await loadGraph();
		await openNote(SECOND);

		labelled('Unlink 2').click();
		await settle();
		await settle();

		expect(graph.get(SECOND)?.links).toEqual([]);
		expect(screen()).not.toContain('Links to');
	});

	it('says so where the note a link points at has gone', async () => {
		graph.set(SECOND, { ...graph.get(SECOND)!, links: [FOURTH] });
		graph.delete(FOURTH);
		nodes.clear();
		await loadGraph();
		await openNote(SECOND);
		await settle();

		expect(screen()).toContain('A note that is no longer here.');
	});
});

// The canvas draws a link dashed and derives the run from the addresses, so a
// reference that wrote a `links` entry would put a hand-drawn line over a
// derived one — DESIGN.md § Edges.
describe('naming another note from inside the writing', () => {
	interface Writing {
		commands: { focus(): boolean; insertContent(words: string): boolean };
	}

	let graph: Map<OwnedRef, NodeView>;
	let placed: unknown;

	/** TipTap hangs the editor off the element it writes into. */
	const writing = (): Writing =>
		(document.body.querySelector('.sloppy-prose') as unknown as { editor: Writing }).editor;

	const rows = () =>
		[...document.body.querySelectorAll<HTMLElement>('[role="option"]')].map((row) => ({
			row,
			reads: (row.textContent ?? '').replace(/\s+/g, ' ').trim()
		}));

	beforeEach(async () => {
		graph = installGraph();
		await loadGraph();
		placed = undefined;
		api.on('POST /nodes', (_url, init) => {
			placed = (JSON.parse(String(init?.body)) as { from?: unknown }).from;
			return node(9, '1b', { origin: FIRST, parent: FIRST, title: 'Guard cells' });
		});
	});

	async function type(words: string): Promise<void> {
		writing().commands.focus();
		writing().commands.insertContent(words);
		flushSync();
		await settle();
	}

	it('writes the note the row names, and draws no line to it', async () => {
		await openNote(SECOND);
		await type('see [[Guard cells');

		const after = rows().find((row) => row.reads === 'Write “Guard cells” after this note');
		expect(after).toBeDefined();
		after?.row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
		await settle();
		await settle();

		expect(placed).toEqual({ relation: 'after', note: SECOND });
		expect(graph.get(SECOND)?.links).toEqual([]);
		expect(api.countOf(`PATCH ${path(SECOND)}`)).toBe(0);
	});
});

describe('starting a note from a shape', () => {
	const WRITTEN = ref(9);

	/** The note's stack as a server holds it: in order, and placed by `after`. */
	let stack: BlockView[];
	/** Every create, in the order it reached the server. */
	let created: CreateBlockRequest[];

	/** A key between two neighbours, so a placed block sorts where it landed. */
	function ordBetween(before: string | undefined, after: string | undefined): string {
		return ((Number(before ?? 0) + Number(after ?? 1)) / 2).toFixed(12);
	}

	function reading(element: DocumentNode): string {
		if (element.text !== undefined) return element.text;
		return (element.content ?? []).map(reading).join('');
	}

	const saying = (of: { content?: { content?: DocumentNode[] } }) =>
		(of.content?.content ?? []).map(reading).join(' ').trim();

	/** TipTap hangs the editor off the element it writes into. */
	const writingIn = (): { commands: { insertContentAt(at: number, text: string): boolean } } =>
		(
			document.body.querySelector('.sloppy-prose') as unknown as {
				editor: { commands: { insertContentAt(at: number, text: string): boolean } };
			}
		).editor;

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

	beforeEach(async () => {
		installGraph();
		stack = [];
		created = [];
		api.on('POST /nodes', () => node(9, '1b', { origin: FIRST, parent: FIRST }));
		api.on(`GET ${path(WRITTEN)}`, () => node(9, '1b', { origin: FIRST, parent: FIRST }));
		for (const of of [SECOND, WRITTEN]) {
			api.on(`GET ${path(of)}/blocks`, () => stack.filter((held) => held.node === of));
		}
		api.on('POST /blocks', (_url, init) => {
			const request = JSON.parse(String(init?.body)) as CreateBlockRequest;
			created.push(request);
			const at = request.after ? stack.findIndex((held) => held.ref === request.after) : -1;
			const row: BlockView = {
				ref: ref(20 + stack.length),
				created_by: DID,
				created_at: AT,
				updated_at: AT,
				node: request.node,
				ord: ordBetween(stack[at]?.ord, stack[at + 1]?.ord),
				content: request.content as BlockView['content']
			};
			stack.splice(at + 1, 0, row);
			return row;
		});
		await loadGraph();
	});

	it('takes the reader to the note even when its sections will not write', async () => {
		api.on('POST /blocks', () => {
			throw new Error('unreachable');
		});
		await openNote(SECOND);

		labelled('A note under this, from a shape').click();
		await settle();
		shape('Objection').click();
		await until(() => screen().includes('Sloppy could not'));

		expect(document.body.querySelector('.address')?.textContent).toBe('1b');
		expect(screen()).toContain('Sloppy could not add those sections');
		expect(screen()).not.toContain('Sloppy could not add that note');
		expect(api.countOf('POST /nodes')).toBe(1);
	});

	it('lands the sections under writing the note had not saved yet', async () => {
		await openNote(SECOND);
		writingIn().commands.insertContentAt(2, 'the thing happened twice');

		button('Add a shape').click();
		await settle();
		shape('Objection').click();
		await until(() => stack.length === 3);

		// The writing reaches the note first, and the first section names it as
		// what it goes after — never the other way round, whichever answers first.
		expect(created.map(saying)).toEqual([
			'the thing happened twice',
			'The objection',
			'What survives if I am right'
		]);
		expect(created[1].after).toBe(stack[0].ref);
		expect(stack.map(saying)).toEqual([
			'the thing happened twice',
			'The objection',
			'What survives if I am right'
		]);
	});

	it('offers the sections without telling a note it is empty', async () => {
		await openNote(SECOND);
		writingIn().commands.insertContentAt(2, 'the thing happened twice');

		button('Add a shape').click();
		await settle();

		expect(screen()).toContain('The sections land under anything already in this note.');
	});
});

/**
 * A branch whose run has a hole in it. `1b` was written and deleted, and its
 * address stayed spent — so `1a`, `1c` and `1d` are what a peer holds, and what
 * the canvas draws consecutive.
 */
function installRun(): Map<OwnedRef, NodeView> {
	const graph = new Map<OwnedRef, NodeView>([
		[FIRST, node(1, '1', { title: 'Origins' })],
		[SECOND, node(2, '1a', { title: 'Cells', origin: FIRST, parent: FIRST })],
		[THIRD, node(3, '1a1', { title: 'Membranes', origin: FIRST, parent: SECOND })],
		[FOURTH, node(4, '2', { title: 'Method' })],
		[FIFTH, node(5, '1c', { title: 'Walls', origin: FIRST, parent: FIRST })],
		[SIXTH, node(6, '1d', { title: 'Pores', origin: FIRST, parent: FIRST })]
	]);
	api.on('GET /nodes', (url) => {
		const origin = url.searchParams.get('origin');
		return [...graph.values()].filter((n) => (origin ? n.origin === origin : n.ref === n.origin));
	});
	for (const of of [FIRST, SECOND, THIRD, FOURTH, FIFTH, SIXTH]) {
		api.on(`GET ${path(of)}`, () => graph.get(of) ?? null);
		api.on(`GET ${path(of)}/blocks`, () => []);
	}
	return graph;
}

describe('walking the graph from a note', () => {
	beforeEach(async () => {
		installRun();
		await loadGraph();
	});

	/** The address the note on screen says it is. */
	const showing = () => document.body.querySelector('.address')?.textContent;

	async function walk(way: string): Promise<void> {
		labelled(way).click();
		await settle();
	}

	it('goes on to the next note along the run, over the gap a delete left', async () => {
		await openNote(SECOND);
		await walk('The note after this, 1c');

		expect(showing()).toBe('1c');
		expect(title()?.value).toBe('Walls');
	});

	it('goes back the way it came', async () => {
		await openNote(FIFTH);
		await walk('The note before this, 1a');

		expect(showing()).toBe('1a');
	});

	it("walks a branch along its author's other branches", async () => {
		await openNote(FIRST);
		await walk('The note after this, 2');

		expect(showing()).toBe('2');
	});

	it('steps down into what grew out of the note', async () => {
		await openNote(SECOND);
		await walk('The first note under this, 1a1');

		expect(showing()).toBe('1a1');
	});

	it('comes back up out of it', async () => {
		await openNote(THIRD);
		await walk('The note this one grew out of, 1a');

		expect(showing()).toBe('1a');
	});

	// The whole point of holding a disabled way in place: a walk is one button
	// pressed again and again, and it must not move out from under the thumb.
	it('keeps every way in its place, and answers only where there is one', async () => {
		await openNote(THIRD);
		const ways = [...document.body.querySelectorAll<HTMLButtonElement>('nav button')];

		expect(ways.map((way) => way.getAttribute('aria-label'))).toEqual([
			'The note this one grew out of, 1a',
			'The note before this',
			'The note after this',
			'The first note under this'
		]);
		expect(ways.map((way) => way.disabled)).toEqual([false, true, true, true]);
	});

	it('offers no way out of a note nothing is near', async () => {
		nodes.clear();
		api.on('GET /nodes', () => []);
		api.on(`GET ${path(FOURTH)}`, () => node(4, '2', { title: 'Method' }));
		await nodes.load();
		await openNote(FOURTH);

		expect(document.body.querySelector('nav')).toBeNull();
	});

	// Walking is the same button pressed again and again, so a note whose
	// sections are in hand must not blank itself on the way back to it.
	it('does not blank a note it has already read while it asks again', async () => {
		api.on(`GET ${path(SECOND)}/blocks`, () => [
			{
				ref: ref(30),
				created_by: DID,
				created_at: AT,
				updated_at: AT,
				node: SECOND,
				ord: '0.5',
				content: {
					type: 'doc',
					content: [
						{
							type: 'section',
							content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ribosomes' }] }]
						}
					]
				}
			}
		]);
		await openNote(SECOND);
		expect(screen()).toContain('Ribosomes');

		await walk('The note after this, 1c');
		labelled('The note before this, 1a').click();
		flushSync();

		expect(document.body.querySelector('[data-slot="skeleton"]')).toBeNull();

		await settle();
		expect(screen()).toContain('Ribosomes');
	});

	// The writing surface's own bar rides the same edge, and a way out of the note
	// under the thumb of somebody mid-sentence is a way out taken by accident.
	it('gets out of the way while a section is being written in', async () => {
		await openNote(SECOND);
		const writing = document.body.querySelector('.sloppy-prose');

		writing?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
		flushSync();
		expect(document.body.querySelector('nav')).toBeNull();

		writing?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
		await new Promise((wake) => setTimeout(wake, 300));
		flushSync();
		expect(document.body.querySelector('nav')).not.toBeNull();
	});

	it('reads the notes either side before anybody asks for them', async () => {
		await openNote(FIFTH);

		expect(api.countOf(`GET ${path(SECOND)}/blocks`)).toBe(1);
		expect(api.countOf(`GET ${path(SIXTH)}/blocks`)).toBe(1);
	});
});

describe('tagging a note', () => {
	let graph: Map<OwnedRef, NodeView>;

	beforeEach(async () => {
		graph = installGraph();
		await loadGraph();
		api.on('GET /tags', () => []);
	});

	const tagField = () => document.body.querySelector('input[role="combobox"]') as HTMLInputElement;

	function typeTag(text: string): void {
		const field = tagField();
		field.value = text;
		field.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
	}

	function commit(): void {
		tagField().dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
		);
		flushSync();
	}

	/** A tap on a row, in the order a browser fires it: the blur, then the click. */
	function tapRow(shows: string): void {
		const row = noteRow(shows);
		tagField().dispatchEvent(new FocusEvent('blur', { bubbles: true }));
		row.click();
	}

	it('writes the word on the note it was typed on, not the one opened next', async () => {
		await openNote(SECOND);
		typeTag('biology');
		tapRow('Membranes');
		await settle();
		await settle();

		expect(graph.get(SECOND)?.tags).toEqual(['biology']);
		expect(graph.get(THIRD)?.tags).toEqual([]);
	});

	it('leaves a refused word behind with the note it was refused on', async () => {
		await openNote(SECOND);
		typeTag('bio\u200blogy');
		commit();
		expect(screen()).toContain('A tag cannot hold hidden characters.');

		tapRow('Membranes');
		await settle();
		await settle();

		expect(tagField().value).toBe('');
		expect(screen()).not.toContain('A tag is one word');
	});

	it('shows the next note its own tags, and writes back only those', async () => {
		await openNote(SECOND);
		typeTag('biology');
		commit();
		await settle();

		noteRow('Membranes').click();
		await settle();
		typeTag('method');
		commit();
		await settle();

		expect(graph.get(SECOND)?.tags).toEqual(['biology']);
		expect(graph.get(THIRD)?.tags).toEqual(['method']);
	});
});

describe('how a note looks', () => {
	let graph: Map<OwnedRef, NodeView>;

	beforeEach(async () => {
		graph = installGraph();
		await loadGraph();
	});

	async function openLook(at: OwnedRef): Promise<void> {
		await openNote(at);
		button('How this note looks').click();
		await settle();
	}

	it('writes the whole look on the note it was chosen on', async () => {
		await openLook(SECOND);
		button('Heavy').click();
		await settle();
		exactly('Large').click();
		await settle();

		expect(graph.get(SECOND)?.appearance).toEqual({
			ring_weight: 'heavy',
			mark_radius: 'large'
		});
		expect(graph.get(THIRD)?.appearance).toBeUndefined();
	});

	// The choice must not sit there looking saved, and what the reader is told is
	// the server's own words for a person — never the route the client named.
	it('puts the choice back when a look will not save, and says so', async () => {
		api.on(
			`PATCH ${path(SECOND)}`,
			() => new Response('{"message":"That look is more than a note can carry."}', { status: 400 })
		);
		await openLook(SECOND);
		button('Heavy').click();
		await settle();

		expect(screen()).toContain('That look is more than a note can carry.');
		expect(screen()).not.toContain('Sloppy API');
		expect(exactly('Heavy').getAttribute('aria-pressed')).toBe('false');
	});
});
