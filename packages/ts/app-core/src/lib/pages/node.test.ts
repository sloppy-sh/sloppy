import type {
	BlockView,
	CreateBlockRequest,
	DocumentNode,
	NodeView,
	NoteDestination,
	OwnedRef,
	ProfileView,
	PullView,
	Tag
} from '@sloppy/types';
import {
	citedNotes,
	homeGraphRef,
	MARK_SCALE_MAX,
	rebaseAddress,
	REFERENCE_NOTE_ATTR
} from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceStore } from '../device-store.js';
import { drafts } from '../stores/drafts.svelte.js';
import { graphs } from '../stores/graphs.svelte.js';
import { nodes } from '../stores/nodes.svelte.js';
import { peers } from '../stores/peers.svelte.js';
import { people } from '../stores/people.svelte.js';
import { session } from '../stores/session.svelte.js';
import {
	AT,
	DID,
	moving,
	node,
	numbering,
	ref,
	ulid,
	unnumbered,
	useFakeApi,
	VIEWER,
	type FakeApi
} from '../stores/fake-api.test-support.js';
import Note from './node.svelte';
import NoteOnSurface from './note-in-panel.test-support.svelte';
import { nodeHref } from './routes.js';

const FIRST = ref(1);
const SECOND = ref(2);
const THIRD = ref(3);
const FOURTH = ref(4);
const FIFTH = ref(5);
const SIXTH = ref(6);

const PHONE = 390;
const TABLET = 834;
const WIDE = 1280;

function refPath(of: OwnedRef): string {
	const cut = of.lastIndexOf('/');
	return `/${encodeURIComponent(of.slice(0, cut))}/${encodeURIComponent(of.slice(cut + 1))}`;
}

const path = (of: OwnedRef) => `/nodes${refPath(of)}`;

/** Only the width queries the surfaces branch on; anything else is unmatched. */
function answers(query: string, width: number): boolean {
	const least = /min-width:\s*(\d+)px/.exec(query);
	if (least) return width >= Number(least[1]);
	const most = /max-width:\s*(\d+)px/.exec(query);
	return most ? width <= Number(most[1]) : false;
}

function stubViewport(width: number): void {
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: (query: string) => ({
			matches: answers(query, width),
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

/** Real timers: what is being waited for is the note settling, not a delay. */
async function until(ready: () => boolean): Promise<void> {
	for (let turn = 0; turn < 200 && !ready(); turn += 1) {
		await new Promise((wake) => setTimeout(wake));
		flushSync();
	}
	if (!ready()) throw new Error('The note never settled');
}

const focused = () => document.activeElement as HTMLElement | null;
const title = () => document.body.querySelector<HTMLTextAreaElement>('[aria-label="Title"]');

/** Where the caret sits in the note's writing, as the element TipTap hangs its
 *  editor off answers for it. */
function caret(): { into: string; at: number } {
	const surface = document.body.querySelector('.sloppy-prose') as unknown as {
		editor?: {
			state: { selection: { $from: { parentOffset: number; parent: { type: { name: string } } } } };
		};
	} | null;
	const where = surface?.editor?.state.selection.$from;
	if (!where) throw new Error('The note has no writing surface');
	return { into: where.parent.type.name, at: where.parentOffset };
}

const acts = () =>
	document.body.querySelector<HTMLButtonElement>('button[aria-label="What to do with this note"]');
const citation = () =>
	document.body.querySelector<HTMLButtonElement>('button[aria-label^="Copy the address"]');

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
	peers.clear();
	people.hold(null);
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

async function openWritten(at: number): Promise<OwnedRef> {
	stubViewport(at);
	const written = await nodes.create({});
	mounted = mount(NoteOnSurface, { target, props: { opened: written.ref } });
	flushSync();
	await settle();
	return written.ref;
}

describe.each([
	['on a phone', PHONE],
	['on a tablet', TABLET],
	['at desktop width', WIDE]
])('a note just written, %s', (_where, at) => {
	it('opens with the caret in its title', async () => {
		await openWritten(at);
		expect(focused()).toBe(title());
	});

	// The key out of the title lands in the writing, so on a phone the keyboard
	// stays up between the name and the thought.
	it.each([['Enter'], ['Tab']])(
		'carries the caret from the title into the writing on %s',
		async (key) => {
			await openWritten(at);
			const field = title();
			if (!field) throw new Error('The note has no title');

			field.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
			await settle();

			expect(focused()?.classList.contains('sloppy-prose')).toBe(true);
			expect(caret()).toEqual({ into: 'paragraph', at: 0 });
		}
	);

	it('hands the caret on to the next note written from inside it', async () => {
		await openWritten(at);

		const write = button('Write a note under this');
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
		mounted = mount(NoteOnSurface, { target, props: { opened: FIRST, fresh: false } });
		flushSync();
		await settle();

		expect(title()).not.toBeNull();
		expect(focused()).not.toBe(title());
	});

	// PRODUCT.md § Design Principles 3: the address is what a person cites, so it
	// leads wherever the note is named — a tab among twenty of them included.
	it('names its window by its address, whether or not it has a title yet', async () => {
		api.on(`PATCH ${path(FIRST)}`, (_url, init) => ({
			...node(1, '1'),
			...(JSON.parse(String(init?.body)) as Partial<NodeView>)
		}));
		stubViewport(WIDE);
		const written = await nodes.create({});
		mounted = mount(NoteOnSurface, { target, props: { opened: written.ref, fresh: false } });
		flushSync();
		await settle();

		expect(document.title).toBe('1 · Untitled · Sloppy');

		await nodes.update(written.ref, { title: 'Origins' });
		await settle();

		expect(document.title).toBe('1 · Origins · Sloppy');
		expect(citation()).not.toBeNull();
	});

	it('names a window on a note with no number by its title', async () => {
		const alone = unnumbered(1);
		api.on('POST /nodes', () => alone);
		api.on(`GET ${path(FIRST)}`, () => alone);
		api.on(`PATCH ${path(FIRST)}`, (_url, init) => ({
			...alone,
			...(JSON.parse(String(init?.body)) as Partial<NodeView>)
		}));
		stubViewport(WIDE);
		const written = await nodes.create({ from: { relation: 'free' } });
		mounted = mount(NoteOnSurface, { target, props: { opened: written.ref, fresh: false } });
		flushSync();
		await settle();

		expect(document.title).toBe('Untitled · Sloppy');

		await nodes.update(written.ref, { title: 'On its own' });
		await settle();

		expect(document.title).toBe('On its own · Sloppy');
	});

	// A note nobody numbered is an ordinary note: everything a person does to
	// one is still here, and only the citation is not.
	it('keeps every act on a note with no number, and offers no address to copy', async () => {
		const alone = unnumbered(1);
		api.on('POST /nodes', () => alone);
		api.on(`GET ${path(FIRST)}`, () => alone);
		session.adopt(VIEWER, 'a-session');
		stubViewport(PHONE);
		const written = await nodes.create({ from: { relation: 'free' } });
		mounted = mount(NoteOnSurface, { target, props: { opened: written.ref, fresh: false } });
		flushSync();
		await settle();

		expect(citation()).toBeNull();
		const open = acts();
		if (!open) throw new Error('The note offers nothing to do with it');
		open.click();
		await settle();

		const offered = document.body.textContent ?? '';
		for (const act of ['Move this note', 'Publishing', 'Tags', 'Delete this note']) {
			expect(offered).toContain(act);
		}
	});

	it('does not call writing it could not read nothing at all', async () => {
		stubViewport(WIDE);
		await nodes.create({});
		api.on(`GET ${path(FIRST)}/blocks`, () => {
			throw new Error('unreachable');
		});

		mounted = mount(NoteOnSurface, { target, props: { opened: FIRST, fresh: false } });
		flushSync();
		await settle();

		expect(document.body.textContent).toContain('Close it and open it again');
		expect(document.body.textContent).not.toContain('Nothing written here yet');
	});

	it('leaves Tab in the title to the browser where there is no writing to reach', async () => {
		stubViewport(WIDE);
		await nodes.create({});
		api.on(`GET ${path(FIRST)}/blocks`, () => {
			throw new Error('unreachable');
		});

		mounted = mount(NoteOnSurface, { target, props: { opened: FIRST, fresh: false } });
		flushSync();
		await settle();
		const field = title();
		if (!field) throw new Error('The note has no title');

		const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
		field.dispatchEvent(tab);
		await settle();

		expect(tab.defaultPrevented).toBe(false);
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
		mounted = mount(NoteOnSurface, { target, props: { opened: FIRST, fresh: false } });
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
	handlers: { onclose?: () => void; onlink?: () => void; onback?: () => void } = {}
): Promise<void> {
	stubViewport(WIDE);
	mounted = mount(NoteOnSurface, { target, props: { opened: at, fresh: false, ...handlers } });
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

/** Everything that is not writing waits behind one control at the head of the
 *  note, so an act is reached by opening that and picking it. */
async function act(named: string): Promise<void> {
	labelled('What to do with this note').click();
	await settle();
	exactly(named).click();
	await settle();
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

/** TipTap hangs the editor off the element it writes into. */
const writingIn = (): { commands: { insertContentAt(at: number, text: string): boolean } } =>
	(
		document.body.querySelector('.sloppy-prose') as unknown as {
			editor: { commands: { insertContentAt(at: number, text: string): boolean } };
		}
	).editor;

/** The row that keeps its place at the head of the note however far it runs —
 *  the way out, the address, the one control every act is asked from, and what
 *  one of those acts was refused. */
const noteHead = () => document.body.querySelector('header')?.textContent ?? '';

/** Only what the typed field turned up: the note's own lists must not answer
 *  for it. */
const offered = () =>
	[...document.body.querySelectorAll('[aria-label="Notes to link to"] button')]
		.map((row) => row.textContent ?? '')
		.join(' ');

const FIND_TO_MOVE = '[aria-label="Move it to a note, by title or address"]';

async function findToLink(typed: string): Promise<void> {
	if (!document.body.querySelector('[aria-label="Link by title or address"]')) {
		await act('Link to another note');
	}
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
		await act('Delete this note');

		expect(screen()).toContain('Delete this note?');
		expect(screen()).toContain('It goes, and so do the 2 notes that grew out of it.');
	});

	it('counts one note as one note', async () => {
		await openNote(SECOND);
		await act('Delete this note');

		expect(screen()).toContain('It goes, and so does the one note that grew out of it.');
	});

	it('promises nothing extra where nothing grew out of it', async () => {
		await openNote(THIRD);
		await act('Delete this note');

		expect(screen()).toContain('It goes.');
		expect(screen()).not.toContain('grew out of it');
	});

	it('will not name a number before the branch it would count is here', async () => {
		nodes.clear();
		await nodes.load();
		await openNote(FIRST);
		await act('Delete this note');

		expect(screen()).toContain('It goes, and so does everything written under it.');
	});

	it('leaves the reader on the note this one grew out of', async () => {
		const graph = installGraph();
		await openNote(THIRD);
		await act('Delete this note');
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
		await act('Delete this note');
		exactly('Delete').click();
		await settle();
		await settle();

		expect(closed).toHaveBeenCalled();
	});

	// A note that is still there and a question that has vanished read as nothing
	// having happened, and this is the one act where that cannot stand.
	it('keeps the question up, with the answer on it, where the note would not go', async () => {
		api.on(`DELETE ${path(THIRD)}`, () => {
			throw new Error('nope');
		});
		await openNote(THIRD);
		await act('Delete this note');
		exactly('Delete').click();
		await settle();
		await settle();

		expect(screen()).toContain('could not delete that note');
		expect(exactly('Delete')).toBeTruthy();
	});

	it('keeps it in front of the reader after the question is dismissed', async () => {
		api.on(`DELETE ${path(THIRD)}`, () => {
			throw new Error('nope');
		});
		await openNote(THIRD);
		await act('Delete this note');
		exactly('Delete').click();
		await settle();
		await settle();

		exactly('Cancel').click();
		await settle();

		expect(noteHead()).toContain('could not delete that note');
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
		button('Write a note under this').click();
		await settle();

		expect(placed).toEqual({ relation: 'under', note: SECOND });
	});

	it('continues the run the one being read is in', async () => {
		await openNote(SECOND);
		button('Write the next note').click();
		await settle();

		expect(placed).toEqual({ relation: 'after', note: SECOND });
	});

	/** The one control at the head of the note, which a reader reaches however
	 *  far down the note they have got. */
	async function fromTheHead(named: string): Promise<void> {
		labelled('What to do with this note').click();
		await settle();
		const menu = [...document.body.querySelectorAll<HTMLElement>('[role="dialog"]')].find(
			(up) => up.dataset.state !== 'closed'
		);
		if (!menu) throw new Error('The note raised no menu');
		const row = [...menu.querySelectorAll('button')].find((b) => b.textContent?.trim() === named);
		if (!row) throw new Error(`The note's menu does not offer "${named}"`);
		row.click();
		await settle();
	}

	// The head of the note is reachable however far the note runs.
	it('springs a note out of the one being read, from the head of the note', async () => {
		await openNote(SECOND);
		await fromTheHead('Write a note under this');

		expect(placed).toEqual({ relation: 'under', note: SECOND });
	});

	it('continues the run from the head of the note', async () => {
		await openNote(SECOND);
		await fromTheHead('Write the next note');

		expect(placed).toEqual({ relation: 'after', note: SECOND });
	});

	it('names the keys that write the same note on the control that writes it', async () => {
		await openNote(SECOND);

		const write = button('Write a note under this');
		expect(write.getAttribute('aria-keyshortcuts')).toContain('Shift+Enter');
		expect(write.getAttribute('aria-label')).toMatch(/^Write a note under this \(.+\)$/);
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

		await act('Link to another note');
		button('Point at it on the graph').click();
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

	// The reader who asked is the one owed the answer, so the sheet stays up to
	// give it rather than closing and leaving it at a head they have scrolled off.
	it('says on the sheet that asked what it would not link', async () => {
		api.on(`PATCH ${path(SECOND)}`, () => {
			throw new Error('nope');
		});
		await openNote(SECOND);
		await findToLink('meth');
		noteRow('Method').click();
		await settle();
		await settle();

		expect(document.body.querySelector('[aria-label="Link by title or address"]')).not.toBeNull();
		expect(screen()).toContain('could not add that link');
		expect(screen()).not.toContain('Links to');
	});

	// The one control every act is asked from rides the head of the note, so its
	// answers do too once the surface that asked has been put away.
	it('keeps a refused link in front of the reader after the sheet is gone', async () => {
		api.on(`PATCH ${path(SECOND)}`, () => {
			throw new Error('nope');
		});
		await openNote(SECOND);
		await findToLink('meth');
		noteRow('Method').click();
		await settle();
		await settle();

		exactly('Close').click();
		await settle();

		expect(noteHead()).toContain('could not add that link');
	});

	// Taking a link off is asked at the foot of the note, where the links are, so
	// that is where it is answered.
	it('says beside the links themselves what it would not unlink', async () => {
		graph.set(SECOND, { ...graph.get(SECOND)!, links: [FOURTH] });
		nodes.clear();
		await loadGraph();
		await openNote(SECOND);
		api.on(`PATCH ${path(SECOND)}`, () => {
			throw new Error('nope');
		});

		labelled('Unlink 2').click();
		await settle();
		await settle();

		expect(screen()).toContain('could not remove that link');
		expect(noteHead()).not.toContain('could not remove that link');
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

describe('moving a note from its own page', () => {
	beforeEach(async () => {
		session.adopt(VIEWER, 'a-session');
		installGraph();
		await loadGraph();
	});

	async function findToMove(typed: string): Promise<void> {
		if (!document.body.querySelector(FIND_TO_MOVE)) await act('Move this note');
		const field = document.body.querySelector<HTMLInputElement>(FIND_TO_MOVE);
		if (!field) throw new Error('The note has no field to name where it goes');
		field.value = typed;
		field.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
	}

	/** A row of the sheet, by what it reads: a note with no address has no
	 *  `.address` for {@link noteRow} to find it by. */
	function rowFor(shows: string): HTMLButtonElement {
		const row = [
			...document.body.querySelectorAll<HTMLButtonElement>(
				'[aria-label="Notes to move it to"] li button'
			)
		].find((one) => one.textContent?.includes(shows));
		if (!row) throw new Error(`The sheet offers no row reading "${shows}"`);
		return row;
	}

	it('finds where it goes by the address a person would cite', async () => {
		await openNote(THIRD);
		await findToMove('2');

		expect(noteRow('Method')).toBeTruthy();
	});

	// A number written down before that note was itself carried still reaches it,
	// so the row says which one it was reached by.
	it('finds where it goes by an address that note has been carried away from', async () => {
		nodes.clear();
		installGraph().set(FOURTH, { ...node(4, '2', { title: 'Method' }), aliases: ['1b'] });
		await loadGraph();
		await openNote(THIRD);
		await findToMove('1b');

		expect(noteRow('Method').textContent).toContain('Was at 1b');
	});

	// The address it takes is the next in the run it joins, which is what somebody
	// deciding between the two placements is choosing between.
	it('says what address each placement gives it', async () => {
		await openNote(THIRD);
		await findToMove('2');
		noteRow('Method').click();
		await settle();

		expect(screen()).toContain('Put it under 2');
		expect(screen()).toContain('It becomes 2a, or the next one free.');
		expect(screen()).toContain('Put it beside 2');
		expect(screen()).toContain('It becomes 3, or the next one free.');
	});

	// AI.md § "The Genealogy Is the Protocol": a note is never moved under
	// itself or a note beneath it.
	it('refuses itself and everything under it, in words', async () => {
		await openNote(FIRST);
		await findToMove('1');
		const rows = [
			...document.body.querySelectorAll<HTMLButtonElement>(
				'[aria-label="Notes to move it to"] li button'
			)
		];

		expect(rows.map((row) => row.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			expect.stringContaining('The note you are moving.'),
			expect.stringContaining('Inside the note you are moving.'),
			expect.stringContaining('Inside the note you are moving.')
		]);
		expect(rows.every((row) => row.disabled)).toBe(true);
	});

	it('carries the note, and says the address that still leads to it', async () => {
		const asked: NoteDestination[] = [];
		moving(api, THIRD, (to) => {
			asked.push(to);
			return [
				{
					...node(3, '2a', { title: 'Membranes', origin: FOURTH, parent: FOURTH }),
					aliases: ['1a1']
				}
			];
		});
		await openNote(THIRD);
		await findToMove('2');
		noteRow('Method').click();
		await settle();

		button('Put it under 2').click();
		await settle();
		await settle();

		expect(asked).toEqual([{ relation: 'under', note: FOURTH }]);
		expect(noteHead()).toContain('2a');
		expect(noteHead()).toContain('was 1a1');
		expect(document.body.querySelector(FIND_TO_MOVE)).toBeNull();
	});

	it('keeps the address it left over the note that is open, not over the next one', async () => {
		moving(api, THIRD, () => [
			{ ...node(3, '2a', { title: 'Membranes', origin: FOURTH, parent: FOURTH }), aliases: ['1a1'] }
		]);
		await openNote(THIRD);
		await findToMove('2');
		noteRow('Method').click();
		await settle();
		button('Put it under 2').click();
		await settle();
		await settle();

		labelled('The note this one grew out of, 2').click();
		await settle();

		expect(noteHead()).not.toContain('was');
	});

	it('says a refusal against the note it was asked of, and keeps the sheet up', async () => {
		api.on(`POST ${path(THIRD)}/move`, () => {
			throw new Error('unreachable');
		});
		await openNote(THIRD);
		await findToMove('2');
		noteRow('Method').click();
		await settle();

		button('Put it under 2').click();
		await settle();
		await settle();

		expect(screen()).toContain('could not move that note');
		expect(screen()).toContain('Put it under 2');
	});

	it('is not offered for a note the reader did not write', async () => {
		session.clear();
		await openNote(THIRD);
		labelled('What to do with this note').click();
		await settle();

		expect(screen()).not.toContain('Move this note');
	});

	// AI.md § "The Genealogy Is the Protocol": a note with no address keeps none
	// wherever it lands, and a run under a note nobody numbered numbers nothing.
	it('offers a note with no number a place to go, without promising it one', async () => {
		nodes.clear();
		installGraph().set(THIRD, unnumbered(3, { title: 'Membranes', origin: FIRST, parent: SECOND }));
		await loadGraph();
		await openNote(THIRD);
		await findToMove('2');
		noteRow('Method').click();
		await settle();

		expect(screen()).toContain('Put it under 2');
		expect(screen()).toContain('It carries no number there.');
		expect(screen()).not.toContain('or the next one free');
	});

	it('carries a note nobody numbered, and says nothing about a number it left', async () => {
		const asked: NoteDestination[] = [];
		nodes.clear();
		installGraph().set(THIRD, unnumbered(3, { title: 'Membranes', origin: FIRST, parent: SECOND }));
		moving(api, THIRD, (to) => {
			asked.push(to);
			return [unnumbered(3, { title: 'Membranes', origin: FOURTH, parent: FOURTH })];
		});
		await loadGraph();
		await openNote(THIRD);
		await findToMove('2');
		noteRow('Method').click();
		await settle();

		button('Put it under 2').click();
		await settle();
		await settle();

		expect(asked).toEqual([{ relation: 'under', note: FOURTH }]);
		expect(noteHead()).not.toContain('was');
		expect(document.body.querySelector(FIND_TO_MOVE)).toBeNull();
	});

	// Beside a note is the run that note's own parent numbers, which a note
	// nobody numbered is not in and does not empty.
	it('numbers a note put beside one with no number, from the run it joins', async () => {
		nodes.clear();
		installGraph().set(FOURTH, unnumbered(4, { title: 'Method' }));
		await loadGraph();
		await openNote(THIRD);
		await findToMove('Method');
		rowFor('Method').click();
		await settle();

		expect(screen()).toContain('Put it under Method');
		expect(screen()).toContain('It carries no number there.');
		expect(screen()).toContain('Put it beside Method');
		expect(screen()).toContain('It becomes 2, or the next one free.');
	});

	it('numbers a note put beside one with no number, under a note that has one', async () => {
		nodes.clear();
		installGraph().set(FIFTH, unnumbered(5, { title: 'Pores', origin: FIRST, parent: SECOND }));
		await loadGraph();
		await openNote(THIRD);
		await findToMove('Pores');
		rowFor('Pores').click();
		await settle();

		expect(screen()).toContain('Put it beside Pores');
		expect(screen()).toContain('It becomes 1a2, or the next one free.');
		expect(screen()).toContain('Put it under Pores');
		expect(screen()).toContain('It carries no number there.');
	});
});

// AI.md § "The Genealogy Is the Protocol": the address is a person's label, and
// a person writes, changes and takes it off wherever one is shown.
describe('writing the address on a note', () => {
	const field = () =>
		document.body.querySelector<HTMLInputElement>(
			'[aria-label="The address you cite this note by"]'
		);

	function type(into: HTMLInputElement, words: string): void {
		into.value = words;
		into.dispatchEvent(new Event('input', { bubbles: true }));
	}

	async function save(): Promise<void> {
		exactly('Save').click();
		await settle();
		await settle();
	}

	beforeEach(async () => {
		session.adopt(VIEWER, 'a-session');
		installGraph();
		await loadGraph();
	});

	it('gives a note that has none the address a person types', async () => {
		const alone = unnumbered(5, { title: 'On its own' });
		api.on(`GET ${path(alone.ref)}`, () => alone);
		api.on(`GET ${path(alone.ref)}/blocks`, () => []);
		const asked: (string | null)[] = [];
		numbering(api, alone.ref, (address) => {
			asked.push(address);
			return { ...alone, address: address ?? undefined };
		});
		await nodes.fetch(alone.ref);
		await openNote(alone.ref);

		exactly('Give it an address').click();
		await settle();
		const typing = field();
		if (!typing) throw new Error('The header has no address field');
		type(typing, '3');
		await save();

		expect(asked).toEqual(['3']);
		expect(noteHead()).toContain('3');
		expect(field()).toBeNull();
	});

	it('takes an address off the note that carries one', async () => {
		const asked: (string | null)[] = [];
		numbering(api, SECOND, (address) => {
			asked.push(address);
			return {
				...node(2, '1a', { title: 'Cells', origin: FIRST, parent: FIRST }),
				address: undefined
			};
		});
		await openNote(SECOND);

		labelled('Edit the address 1a').click();
		await settle();
		exactly('Take it off').click();
		await settle();
		await settle();

		expect(asked).toEqual([null]);
		expect(noteHead()).toContain('Give it an address');
	});

	it('repeats the server’s words when the address is refused, and keeps the field up', async () => {
		numbering(
			api,
			SECOND,
			() =>
				new Response(JSON.stringify({ message: '1b is already the address of another note.' }), {
					status: 409,
					headers: { 'content-type': 'application/json' }
				}) as unknown as NodeView
		);
		await openNote(SECOND);

		labelled('Edit the address 1a').click();
		await settle();
		const typing = field();
		if (!typing) throw new Error('The header has no address field');
		type(typing, '1b');
		await save();

		expect(noteHead()).toContain('1b is already the address of another note.');
		expect(field()).not.toBeNull();
	});

	it('says plainly what an address looks like, rather than asking the server', async () => {
		const asked: (string | null)[] = [];
		numbering(api, SECOND, (address) => {
			asked.push(address);
			return node(2, '1a', { title: 'Cells', origin: FIRST, parent: FIRST });
		});
		await openNote(SECOND);

		labelled('Edit the address 1a').click();
		await settle();
		const typing = field();
		if (!typing) throw new Error('The header has no address field');
		type(typing, 'a note');
		await save();

		expect(asked).toEqual([]);
		expect(noteHead()).toContain('Number a note like 1a1');
		expect(field()).not.toBeNull();
	});

	it('leaves the address alone when the reader backs out of the field', async () => {
		const asked: (string | null)[] = [];
		numbering(api, SECOND, (address) => {
			asked.push(address);
			return node(2, address ?? '1a', { title: 'Cells', origin: FIRST, parent: FIRST });
		});
		await openNote(SECOND);

		labelled('Edit the address 1a').click();
		await settle();
		const typing = field();
		if (!typing) throw new Error('The header has no address field');
		type(typing, '4');
		labelled('Leave the address as it is').click();
		await settle();

		expect(asked).toEqual([]);
		expect(labelled('Edit the address 1a')).toBeTruthy();
	});

	it('leaves a note the reader did not write with nothing to write on it', async () => {
		session.clear();
		await openNote(SECOND);

		expect(noteHead()).not.toContain('Give it an address');
		expect(
			[...document.body.querySelectorAll('button')].some(
				(b) => b.getAttribute('aria-label')?.startsWith('Edit the address') === true
			)
		).toBe(false);
		expect(labelled('Copy the address 1a')).toBeTruthy();
	});
});

// AI.md § "The Genealogy Is the Protocol": a number whose shape says the note
// springs from another one is a question about where the note sits, never a
// label written over a genealogy that disagrees with it.
describe('a number that says the note springs from somewhere else', () => {
	const field = () =>
		document.body.querySelector<HTMLInputElement>(
			'[aria-label="The address you cite this note by"]'
		);

	let carried: { to: NoteDestination; address?: string }[];
	let written: (string | null)[];

	/** `1a`, under `1`, with `1a1` under it and `2` on its own branch. `reads` is
	 *  whether every graph this person keeps opens; `alter` changes the graph
	 *  before it is read. */
	async function openCells(
		reads = true,
		alter?: (graph: Map<OwnedRef, NodeView>) => void
	): Promise<void> {
		const graph = installGraph();
		alter?.(graph);
		api.on('GET /graphs', () => {
			if (!reads) throw new Error('unreachable');
			return [
				{
					ref: homeGraphRef(DID),
					created_by: DID,
					created_at: AT,
					updated_at: AT,
					title: 'My graph'
				}
			];
		});
		carried = [];
		written = [];
		numbering(api, SECOND, (address) => {
			written.push(address);
			return { ...(graph.get(SECOND) as NodeView), address: address ?? undefined };
		});
		moving(api, SECOND, (to, address) => {
			carried.push({ to, ...(address === undefined ? {} : { address }) });
			return [
				{ ...(graph.get(SECOND) as NodeView), address, parent: FOURTH, origin: FOURTH, depth: 2 },
				{
					...(graph.get(THIRD) as NodeView),
					address: address ? rebaseAddress('1a', address, '1a1') : undefined,
					origin: FOURTH,
					depth: 3
				}
			] as NodeView[];
		});
		await loadGraph();
		await openNote(SECOND);
		labelled('Edit the address 1a').click();
		await settle();
	}

	async function write(words: string): Promise<void> {
		const typing = field();
		if (!typing) throw new Error('The header has no address field');
		typing.value = words;
		typing.dispatchEvent(new Event('input', { bubbles: true }));
		exactly('Save').click();
		await settle();
		await settle();
	}

	beforeEach(() => {
		graphs.clear();
		session.adopt(VIEWER, 'a-session');
	});

	it('asks before writing it, naming both places', async () => {
		await openCells();
		await write('2a');

		expect(screen()).toContain('2a springs from 2.');
		expect(screen()).toContain('This note springs from 1.');
		expect(written).toEqual([]);
		expect(carried).toEqual([]);
	});

	it('carries the note and everything under it, on that number', async () => {
		await openCells();
		await write('2a');

		button('Move it under 2').click();
		await settle();
		await settle();

		expect(carried).toEqual([{ to: { relation: 'under', note: FOURTH }, address: '2a' }]);
		expect(written).toEqual([]);
		expect(nodes.get(SECOND)?.address).toBe('2a');
		expect(nodes.children(FOURTH).map((one) => one.ref)).toEqual([SECOND]);
		expect(nodes.children(SECOND).map((one) => one.address)).toEqual(['2a1']);
	});

	it('writes it as a label alone where that is what the reader meant', async () => {
		await openCells();
		await write('2a');

		button('Keep it under 1 as 2a').click();
		await settle();
		await settle();

		expect(written).toEqual(['2a']);
		expect(carried).toEqual([]);
	});

	it('offers a branch of its own to a note given a whole number', async () => {
		await openCells();
		await write('5');

		expect(screen()).toContain("5 is a branch's own number.");
		button('Make it a branch of its own').click();
		await settle();
		await settle();

		expect(carried).toEqual([{ to: { relation: 'after', note: FIRST }, address: '5' }]);
	});

	it('says when nothing in the graph is at the number it springs from', async () => {
		await openCells();
		await write('9a1');
		await until(() => screen().includes('There is no note at 9a yet'));

		button('Keep it under 1 as 9a1').click();
		await settle();
		await settle();

		expect(written).toEqual(['9a1']);
	});

	// AI.md § "The Genealogy Is the Protocol": a number that leads somewhere
	// unread is not a number that leads nowhere, and the difference is the whole
	// of what the person is deciding on.
	it('never says there is no such note while a graph has not read', async () => {
		await openCells(false);
		await write('9a1');
		await until(() => screen().includes('Look again'));

		expect(screen()).not.toContain('There is no note at 9a yet');
		expect(screen()).toContain('a note at 9a may be missing here');
		expect(button('Keep it under 1 as 9a1')).toBeTruthy();
	});

	it('names the number that reaches the note it would carry it under, and where that leads now', async () => {
		await openCells(true, (graph) =>
			graph.set(FOURTH, { ...node(4, '5', { title: 'Method' }), aliases: ['2'] })
		);
		await write('2a');

		expect(screen()).toContain('2a springs from 2, which now leads to 5.');
		expect(screen()).toContain('It takes the next number under 5');
		button('Move it under 2, now 5').click();
		await settle();
		await settle();

		expect(carried).toEqual([{ to: { relation: 'under', note: FOURTH } }]);
	});

	it('refuses a number that springs from a note this one carries, and asks nothing', async () => {
		await openCells();
		await write('1a1a');

		expect(noteHead()).toContain('1a1 springs from this note');
		expect(screen()).not.toContain('Move it under');
		expect(written).toEqual([]);
		expect(carried).toEqual([]);
	});

	it('writes a number that springs from the note it already does, with no question', async () => {
		await openCells();
		await write('1b');

		expect(written).toEqual(['1b']);
		expect(screen()).not.toContain('Where should this note sit?');
	});

	it('repeats the server’s words when the carry is refused, and keeps the question up', async () => {
		await openCells();
		api.on(
			`POST ${path(SECOND)}/move`,
			() =>
				new Response(JSON.stringify({ message: '2a already leads to “Method”.' }), {
					status: 400,
					headers: { 'content-type': 'application/json' }
				})
		);
		await write('2a');

		button('Move it under 2').click();
		await settle();
		await settle();

		expect(screen()).toContain('2a already leads to “Method”.');
		expect(screen()).toContain('Move it under 2');
	});
});

// The line a citation draws comes from `references`, derived from the writing,
// so citing a note leaves `links` — what a hand drew — untouched.
// DESIGN.md § Edges.
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

	it('writes the note the row names, and leaves its links alone', async () => {
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

	function shape(named: string): HTMLButtonElement {
		const found = [...document.body.querySelectorAll<HTMLButtonElement>('li button')].find(
			(row) => row.querySelector('span')?.textContent?.trim() === named
		);
		if (!found) throw new Error(`No shape on screen is called "${named}"`);
		return found;
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

		labelled('Write a note under this, from a shape').click();
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

const SECTION = ref(30);

/** A note's one section, as a server holds it. */
function section(of: OwnedRef, words: string): BlockView {
	return {
		ref: SECTION,
		created_by: DID,
		created_at: AT,
		updated_at: AT,
		node: of,
		ord: '0.5',
		content: {
			type: 'doc',
			content: [{ type: 'paragraph', content: [{ type: 'text', text: words }] }]
		}
	};
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

	// A read that failed once must not follow the note around: walking back to it
	// reads again, and what comes back is the note.
	it('shows the sections of a note whose read failed before it was walked away from', async () => {
		let refuse = true;
		api.on(`GET ${path(SECOND)}/blocks`, () =>
			refuse
				? new Response('{"message":"Sloppy is having a moment."}', { status: 503 })
				: [section(SECOND, 'The wall is the point')]
		);

		await openNote(SECOND);
		expect(document.body.textContent).toContain('Sloppy is having a moment.');

		refuse = false;
		await walk('The note after this, 1c');
		await walk('The note before this, 1a');

		expect(showing()).toBe('1a');
		expect(document.body.textContent).toContain('The wall is the point');
		expect(document.body.textContent).not.toContain('Sloppy is having a moment.');
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
		api.on(`GET ${path(SECOND)}/blocks`, () => [section(SECOND, 'Ribosomes')]);
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

describe('the sections of a note walked away from', () => {
	/** The server's copy of what `1a` holds. */
	let held: BlockView;

	beforeEach(async () => {
		installRun();
		await loadGraph();
		held = section(SECOND, 'Ribosomes');
		api.on(`GET ${path(SECOND)}/blocks`, () => [held]);
		api.on(`PATCH /blocks${refPath(SECTION)}`, (_url, init) => {
			const { content } = JSON.parse(String(init?.body)) as Pick<BlockView, 'content'>;
			held = { ...held, content };
			return held;
		});
	});

	// The surface sends its last write as it is taken down, by which time the
	// reader is on the next note along.
	it('keeps writing with the note it was typed in, not the one walked on to', async () => {
		await openNote(SECOND);
		writingIn().commands.insertContentAt(2, 'Free ');

		labelled('The note after this, 1c').click();
		await until(() => api.countOf(`PATCH /blocks${refPath(SECTION)}`) === 1);

		labelled('The note before this, 1a').click();
		flushSync();

		expect(screen()).toContain('Free Ribosomes');
	});

	it('reads a note again as it now is where it changed while nobody was on it', async () => {
		await openNote(SECOND);
		expect(screen()).toContain('Ribosomes');

		labelled('The note after this, 1c').click();
		await settle();
		held = section(SECOND, 'Mitochondria');

		labelled('The note before this, 1a').click();
		flushSync();
		expect(screen()).toContain('Ribosomes');

		await settle();
		expect(screen()).toContain('Mitochondria');
		expect(screen()).not.toContain('Ribosomes');
	});
});

describe('writing the server will not take', () => {
	let held: BlockView;

	/** The app put away, which writes everything resting rather than waiting. */
	function background(): void {
		Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
		document.dispatchEvent(new Event('visibilitychange'));
	}

	const patch = `PATCH /blocks${refPath(SECTION)}`;

	beforeEach(async () => {
		session.adopt(VIEWER, 'a-session');
		// A surface writes its last draft as it is taken down, which is after the
		// suite's own teardown; so this device starts each of these clean.
		drafts.forget(SECOND);
		await deviceStore.forget(VIEWER.did);
		installRun();
		await loadGraph();
		held = section(SECOND, 'Ribosomes');
		api.on(`GET ${path(SECOND)}/blocks`, () => [held]);
	});

	afterEach(() => {
		vi.useRealTimers();
		Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
	});

	it('reads the note again, and keeps the unsent writing beside what came in', async () => {
		api.on(
			patch,
			() => new Response('{"message":"That section was written somewhere else."}', { status: 409 })
		);
		await openNote(SECOND);
		writingIn().commands.insertContentAt(2, 'Free ');
		held = { ...section(SECOND, 'Mitochondria'), updated_at: '2026-02-02T00:00:00.000Z' };

		background();
		await until(() => api.countOf(`GET ${path(SECOND)}/blocks`) >= 2);
		await settle();

		expect(screen()).toContain('Mitochondria');
		expect(screen()).toContain('Free Ribosomes');
		expect(screen()).toContain('This note was also written somewhere else.');
	});

	it('stops asking, in the server’s own words, where asking again cannot land it', async () => {
		api.on(
			patch,
			() => new Response('{"message":"That section is too long to save."}', { status: 422 })
		);
		await openNote(SECOND);

		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		writingIn().commands.insertContentAt(2, 'Free ');
		background();
		await vi.advanceTimersByTimeAsync(1000);
		const tried = api.countOf(patch);
		await vi.advanceTimersByTimeAsync(30000);

		expect(tried).toBe(1);
		expect(api.countOf(patch)).toBe(1);
		expect(screen()).toContain('That section is too long to save.');
	});

	it('says on the note when the last writing has not been saved yet', async () => {
		api.on(patch, () => new Response('{"message":"Sloppy is busy."}', { status: 503 }));
		await openNote(SECOND);

		// Only the clocks the surface and the device keep; the fake server runs on
		// the loop.
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		writingIn().commands.insertContentAt(2, 'Free ');
		background();
		await vi.advanceTimersByTimeAsync(4000);
		flushSync();

		const tried = api.countOf(patch);
		expect(tried).toBeGreaterThan(0);
		expect(screen()).toContain('Not saved yet. Your writing is kept on this device.');

		await vi.advanceTimersByTimeAsync(10000);
		expect(api.countOf(patch)).toBeGreaterThan(tried);
	});
});

describe('writing the server is taking', () => {
	const patch = `PATCH /blocks${refPath(SECTION)}`;

	beforeEach(async () => {
		session.adopt(VIEWER, 'a-session');
		drafts.forget(SECOND);
		await deviceStore.forget(VIEWER.did);
		installRun();
		await loadGraph();
		let held = section(SECOND, 'Ribosomes');
		api.on(`GET ${path(SECOND)}/blocks`, () => [held]);
		// Every save takes a moment, so somebody writing without pausing always
		// has something on its way to the server.
		api.on(patch, async (_url, init) => {
			const { content } = JSON.parse(String(init?.body)) as Pick<BlockView, 'content'>;
			await new Promise((wake) => setTimeout(wake, 400));
			held = { ...held, content };
			return held;
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('says nothing about this device to somebody whose writing keeps landing', async () => {
		await openNote(SECOND);

		// Only the clocks the surface and the device keep; the fake server runs on
		// the loop.
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		for (let stroke = 0; stroke < 12; stroke += 1) {
			writingIn().commands.insertContentAt(2, '.');
			await vi.advanceTimersByTimeAsync(800);
		}
		flushSync();

		expect(api.countOf(patch)).toBeGreaterThan(1);
		expect(noteHead()).not.toContain('Not saved yet.');

		await vi.advanceTimersByTimeAsync(10000);
		flushSync();
		expect(noteHead()).not.toContain('Not saved yet.');
	});
});

describe('the note menu while another note is being written', () => {
	beforeEach(async () => {
		installRun();
		await loadGraph();
	});

	it('offers no row that could not be acted on', async () => {
		stubViewport(WIDE);
		mounted = mount(NoteOnSurface, {
			target,
			props: { opened: SECOND, fresh: false, writingAnother: true }
		});
		flushSync();
		await settle();

		labelled('What to do with this note').click();
		await settle();

		const menu = document.body.querySelector('[role="dialog"]') as HTMLElement;
		const rows = [...menu.querySelectorAll('button')].map((b) => b.textContent?.trim());
		expect(rows).toContain('Tags');
		expect(rows).not.toContain('Write a note under this');
		expect(rows).not.toContain('Write the next note');
	});
});

// DESIGN.md § Edges: a `[[` draws a line, and what a note cites is derived from
// its own writing — so saving a section moves the note's row under every surface
// reading it, this one included.
describe('a section naming another note', () => {
	let graph: Map<OwnedRef, NodeView>;
	let held: BlockView;

	/** TipTap hangs the editor off the element it writes into. */
	const writingIn = (): { commands: { insertContentAt(at: number, content: unknown): boolean } } =>
		(
			document.body.querySelector('.sloppy-prose') as unknown as {
				editor: { commands: { insertContentAt(at: number, content: unknown): boolean } };
			}
		).editor;

	beforeEach(async () => {
		graph = installRun();
		await loadGraph();
		held = section(SECOND, 'Ribosomes');
		api.on(`GET ${path(SECOND)}/blocks`, () => [held]);
		api.on(`GET ${path(SECOND)}`, () => ({
			...(graph.get(SECOND) as NodeView),
			references: citedNotes(held.content)
		}));
		api.on(`PATCH /blocks${refPath(SECTION)}`, (_url, init) => {
			const { content } = JSON.parse(String(init?.body)) as Pick<BlockView, 'content'>;
			held = { ...held, content };
			return held;
		});
	});

	it('reaches the canvas without the note itself being written to', async () => {
		await openNote(SECOND);
		writingIn().commands.insertContentAt(2, {
			type: 'reference',
			attrs: { [REFERENCE_NOTE_ATTR]: THIRD, label: 'Membranes' }
		});

		labelled('The note after this, 1c').click();
		await until(() => api.countOf(`PATCH /blocks${refPath(SECTION)}`) === 1);
		await until(() => (nodes.get(SECOND)?.references ?? []).length > 0);

		expect(nodes.get(SECOND)?.references).toEqual([THIRD]);
		expect(api.countOf(`PATCH ${path(SECOND)}`)).toBe(0);
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

	async function openTags(): Promise<void> {
		await act('Tags');
	}

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

	// Left to itself the sheet takes the first thing it can focus, which on a note
	// that already carries a tag is that chip's Remove: one keystroke from
	// dropping a tag on a surface opened to add one.
	it('opens with the caret in the field, not on a tag it would drop', async () => {
		await nodes.update(SECOND, { tags: ['biology'] as Tag[] });
		await openNote(SECOND);
		await openTags();

		expect(focused()).toBe(tagField());
	});

	it('writes the word on the note it was typed on, not the one opened next', async () => {
		await openNote(SECOND);
		await openTags();
		typeTag('biology');
		tapRow('Membranes');
		await settle();
		await settle();

		expect(graph.get(SECOND)?.tags).toEqual(['biology']);
		expect(graph.get(THIRD)?.tags).toEqual([]);
	});

	it('leaves a refused word behind with the note it was refused on', async () => {
		await openNote(SECOND);
		await openTags();
		typeTag('bio\u200blogy');
		commit();
		expect(screen()).toContain('A tag cannot hold hidden characters.');

		tapRow('Membranes');
		await settle();
		await settle();

		await openTags();
		expect(tagField().value).toBe('');
		expect(screen()).not.toContain('A tag is one word');
	});

	// The field says it while its sheet stands; once the sheet is gone the note
	// has to, or a word that never saved goes unanswered.
	it('keeps a refused tag in front of the reader after the sheet is gone', async () => {
		api.on(`PATCH ${path(SECOND)}`, () => {
			throw new Error('nope');
		});
		await openNote(SECOND);
		await openTags();
		typeTag('biology');
		commit();
		await settle();
		await settle();
		expect(screen()).toContain('could not save that tag');

		exactly('Close').click();
		await settle();

		expect(noteHead()).toContain('could not save that tag');
	});

	it('shows the next note its own tags, and writes back only those', async () => {
		await openNote(SECOND);
		await openTags();
		typeTag('biology');
		commit();
		await settle();

		noteRow('Membranes').click();
		await settle();
		await openTags();
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

	/** What one of the note's two sides is showing. Both stay on the page, so
	 *  which one a reader is on is read off the side itself. */
	function side(named: string): HTMLElement {
		const shows = exactly(named).getAttribute('aria-controls');
		const found = shows ? document.getElementById(shows) : null;
		if (!found) throw new Error(`the ${named} tab shows nothing`);
		return found;
	}

	/** How a note is drawn is a side of it, so this is the whole way in. */
	async function openLook(at: OwnedRef): Promise<void> {
		await openNote(at);
		exactly('Look').click();
		await settle();
	}

	/** A size is dragged, and a keyboard is the one way jsdom holds a thumb. */
	async function dragSize(key: string): Promise<void> {
		const thumb = side('Look').querySelector<HTMLElement>('[role="slider"]');
		if (!thumb) throw new Error('the Look side has no size to drag');
		thumb.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
		await settle();
	}

	it('is reached from the note itself, without opening what to do with it', async () => {
		await openNote(SECOND);
		expect(side('Look').hidden).toBe(true);

		exactly('Look').click();
		await settle();

		expect(side('Look').hidden).toBe(false);
		expect(side('Look').textContent).toContain('Ring');
	});

	// Two places that set the same thing is one of them being wrong.
	it('is not also an act on the note menu', async () => {
		await openNote(SECOND);
		labelled('What to do with this note').click();
		await settle();

		expect(screen()).not.toContain('Give it a look');
	});

	it('opens on what the note says, and comes back to it', async () => {
		await openNote(SECOND);
		expect(side('Note').hidden).toBe(false);

		exactly('Look').click();
		await settle();
		expect(side('Note').hidden).toBe(true);

		exactly('Note').click();
		await settle();
		expect(side('Note').hidden).toBe(false);
	});

	it('opens the next note on what it says, whichever side the last was left on', async () => {
		await openLook(SECOND);
		labelled('The first note under this, 1a1').click();
		await settle();

		expect(side('Note').hidden).toBe(false);
	});

	it('writes the whole look on the note it was chosen on', async () => {
		await openLook(SECOND);
		button('Heavy').click();
		await settle();
		await dragSize('End');

		expect(graph.get(SECOND)?.appearance).toEqual({
			ring_weight: 'heavy',
			mark_scale: MARK_SCALE_MAX
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

	// "give me some control to increase the size of the whole node currently i
	// cant, its just auto determined from the amount of collapsed notes in it".
	it('stores a size past the one a fold alone reaches', async () => {
		await openLook(SECOND);
		await dragSize('End');

		expect(graph.get(SECOND)?.appearance).toEqual({ mark_scale: MARK_SCALE_MAX });
	});

	// "give me sliders ... rather than give me pre set sizes for the node": a
	// size between two of the old steps is one somebody can now ask for.
	it('stores a size no step on the old ladder could say', async () => {
		await openLook(SECOND);
		await dragSize('ArrowRight');

		expect(graph.get(SECOND)?.appearance).toEqual({ mark_scale: 1.01 });
	});
});

// The developer's ruling: a link across graphs behaves exactly like a link
// within one, and means the same thing from both ends.
describe('linking a note to one in another graph', () => {
	const GARDEN = ref(30);
	const BEDS = ref(31);
	const HOME = homeGraphRef(DID);
	let graph: Map<OwnedRef, NodeView>;

	function listedGraph(self: OwnedRef, title: string) {
		return { ref: self, created_by: DID, created_at: AT, updated_at: AT, title };
	}

	beforeEach(async () => {
		graphs.clear();
		graph = installGraph();
		graph.set(BEDS, node(31, '1', { title: 'Beds', graph: GARDEN }));
		api.on('GET /graphs', () => [listedGraph(HOME, 'My graph'), listedGraph(GARDEN, 'Garden')]);
		api.on(`GET ${path(BEDS)}`, () => graph.get(BEDS) ?? null);
		api.on(`GET ${path(BEDS)}/blocks`, () => []);
		api.on('GET /nodes', (url) => {
			const origin = url.searchParams.get('origin');
			if (origin) {
				return [...graph.values()].filter((n) => n.origin === origin && n.ref !== origin);
			}
			const of = url.searchParams.get('graph') ?? HOME;
			return [...graph.values()].filter((n) => n.ref === n.origin && (n.graph ?? HOME) === of);
		});
		await loadGraph();
	});

	it('offers it to link to, saying which graph it is read in', async () => {
		await openNote(SECOND);
		await until(() => nodes.get(BEDS) !== undefined);
		await findToLink('beds');

		expect(offered()).toContain('Beds');
		expect(offered()).toContain('Garden');
	});

	it('links to it, and the row says which graph it went to', async () => {
		await openNote(SECOND);
		await until(() => nodes.get(BEDS) !== undefined);
		await findToLink('beds');
		noteRow('Beds').click();
		await settle();
		await settle();

		expect(graph.get(SECOND)?.links).toEqual([BEDS]);
		expect(labelled('1 Beds, in Garden')).toBeTruthy();
	});

	it('tells the note in the other graph where the link came from', async () => {
		graph.set(SECOND, { ...graph.get(SECOND)!, links: [BEDS] });
		nodes.clear();
		await loadGraph();
		await openNote(BEDS);
		await until(() => screen().includes('Linked from'));

		expect(noteRow('Cells')).toBeTruthy();
		expect(labelled('1a Cells, in My graph')).toBeTruthy();
	});

	/** Garden will not read; every other graph answers as it did. */
	function gardenWillNotRead(): void {
		api.on('GET /nodes', (url) => {
			const origin = url.searchParams.get('origin');
			if (origin) {
				return [...graph.values()].filter((n) => n.origin === origin && n.ref !== origin);
			}
			const of = url.searchParams.get('graph') ?? HOME;
			if (of === GARDEN) throw new Error('unreachable');
			return [...graph.values()].filter((n) => n.ref === n.origin && (n.graph ?? HOME) === of);
		});
	}

	it('never says there is no such note while a graph has not read', async () => {
		gardenWillNotRead();
		nodes.clear();
		await loadGraph();
		await openNote(SECOND);
		await findToLink('beds');
		await until(() => screen().includes('Look again'));

		expect(screen()).not.toContain('Nothing here matches that.');
	});

	it('reads the graphs after one that will not read', async () => {
		const COMPOST = ref(40);
		const HEAP = ref(41);
		graph.set(HEAP, node(41, '1', { title: 'Heaps', graph: COMPOST }));
		api.on('GET /graphs', () => [
			listedGraph(HOME, 'My graph'),
			listedGraph(GARDEN, 'Garden'),
			listedGraph(COMPOST, 'Compost')
		]);
		gardenWillNotRead();
		api.on(`GET ${path(HEAP)}`, () => graph.get(HEAP) ?? null);
		nodes.clear();
		await loadGraph();
		await openNote(SECOND);
		await until(() => nodes.get(HEAP) !== undefined);
		await findToLink('heap');

		expect(offered()).toContain('Heaps');
		expect(offered()).toContain('Compost');
	});

	// Deleting either end does what it does within one graph: the note goes, and
	// the ref left behind stops resolving.
	it('says so at the near end once the far note is gone', async () => {
		graph.set(SECOND, { ...graph.get(SECOND)!, links: [BEDS] });
		nodes.clear();
		await loadGraph();
		graph.delete(BEDS);
		nodes.forget(BEDS);
		await openNote(SECOND);
		await until(() => screen().includes('A note that is no longer here.'));

		expect(screen()).toContain('A note that is no longer here.');
	});
});

// PRODUCT.md § "Capture is one gesture": the note that springs from this one is
// somewhere to write the moment it is asked for, not the moment it is answered.
describe('writing the next note while the server is still assigning its address', () => {
	const WRITTEN = ref(9);
	let give: (value: NodeView) => void;

	beforeEach(async () => {
		installGraph();
		await loadGraph();
		const waiting = new Promise<NodeView>((settle) => (give = settle));
		api.on('POST /nodes', () => waiting);
		api.on(`GET ${path(WRITTEN)}`, () => node(9, '1b', { origin: FIRST, parent: FIRST }));
		api.on(`GET ${path(WRITTEN)}/blocks`, () => []);
	});

	it('opens somewhere to write on the tap, with the address still being given', async () => {
		await openNote(SECOND);
		button('Write a note under this').click();
		await settle();

		expect(screen()).toContain('Giving it an address');
		expect(focused()).toBe(title());
		expect(document.body.querySelector('.address')).toBeNull();
	});

	it('keeps the title typed into it, and shows the address the server gave', async () => {
		await openNote(SECOND);
		button('Write the next note').click();
		await settle();
		const field = title();
		if (!field) throw new Error('There is nowhere to write the title');
		field.value = 'Membranes';
		field.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();

		give(node(9, '1b', { origin: FIRST, parent: FIRST }));
		await settle();

		expect(document.body.querySelector('.address')?.textContent).toBe('1b');
		expect(title()?.value).toBe('Membranes');
	});
});

describe('what points back at a note', () => {
	let graph: Map<OwnedRef, NodeView>;

	/** The list one of the note's headings stands over. */
	function listUnder(heading: string): HTMLElement {
		const head = [...document.body.querySelectorAll('h2')].find(
			(one) => one.textContent?.trim() === heading
		);
		const list = head?.nextElementSibling;
		if (!(list instanceof HTMLElement)) throw new Error(`Nothing is listed under "${heading}"`);
		return list;
	}

	beforeEach(() => {
		graph = installGraph();
	});

	// DESIGN.md § "Edges": a hand draws a link and a hand takes it away; a
	// reference is the note's own words and goes when they do. Two lists.
	it('keeps the notes whose writing names this one apart from the ones a hand linked', async () => {
		graph.set(SECOND, { ...graph.get(SECOND)!, references: [FOURTH] });
		graph.set(THIRD, { ...graph.get(THIRD)!, links: [FOURTH] });
		await loadGraph();
		await openNote(FOURTH);

		expect(listUnder('Named in').textContent).toContain('Cells');
		expect(listUnder('Named in').textContent).not.toContain('Membranes');
		expect(listUnder('Linked from').textContent).toContain('Membranes');
		expect(listUnder('Linked from').textContent).not.toContain('Cells');
	});

	it('opens the note that named this one', async () => {
		graph.set(SECOND, { ...graph.get(SECOND)!, references: [FOURTH] });
		await loadGraph();
		await openNote(FOURTH);

		noteRow('Cells').click();
		await settle();

		expect(document.body.querySelector('.address')?.textContent).toBe('1a');
	});

	// The words made the line, so this is not the side it can be taken off.
	it('offers no way to take a reference off from here', async () => {
		graph.set(SECOND, { ...graph.get(SECOND)!, references: [FOURTH] });
		await loadGraph();
		await openNote(FOURTH);

		expect(listUnder('Named in').querySelector('[aria-label^="Unlink"]')).toBeNull();
	});

	it('names nothing where no note names this one', async () => {
		await loadGraph();
		await openNote(FOURTH);

		expect(screen()).not.toContain('Named in');
	});
});

describe('the way out of a note', () => {
	beforeEach(async () => {
		installGraph();
		await loadGraph();
	});

	function wayOut(): HTMLButtonElement {
		const found = [...document.body.querySelectorAll('button')].find((b) =>
			['Graph', 'Back'].includes(b.textContent?.trim() ?? '')
		);
		if (!found) throw new Error('The note on screen has no way out');
		return found;
	}

	it('is the graph at the head of the trail', async () => {
		let closed = 0;
		await openNote(SECOND, { onclose: () => (closed += 1) });

		expect(wayOut().textContent?.trim()).toBe('Graph');
		wayOut().click();
		await settle();

		expect(closed).toBe(1);
	});

	it('is the way back where the reader came here from another note', async () => {
		let walked = 0;
		let closed = 0;
		await openNote(SECOND, { onback: () => (walked += 1), onclose: () => (closed += 1) });

		expect(wayOut().textContent?.trim()).toBe('Back');
		wayOut().click();
		await settle();

		expect(walked).toBe(1);
		expect(closed).toBe(0);
	});
});

describe('the sections this device kept', () => {
	beforeEach(async () => {
		session.adopt(VIEWER, 'a-session');
		installGraph();
		await loadGraph();
	});

	async function reopen(of: OwnedRef): Promise<void> {
		unmount(mounted!, { outro: false });
		mounted = undefined;
		await openNote(of);
	}

	it('shows a note as it was last read, without waiting on the server', async () => {
		api.on(`GET ${path(SECOND)}/blocks`, () => [section(SECOND, 'The wall is the point')]);
		await openNote(SECOND);
		expect(screen()).toContain('The wall is the point');

		api.on(`GET ${path(SECOND)}/blocks`, () => {
			throw new Error('nothing is listening');
		});
		await reopen(SECOND);

		expect(screen()).toContain('The wall is the point');
		expect(screen()).not.toContain('Close it and open it again');
	});

	it('takes what the server says over what was kept', async () => {
		api.on(`GET ${path(SECOND)}/blocks`, () => [section(SECOND, 'The wall is the point')]);
		await openNote(SECOND);

		api.on(`GET ${path(SECOND)}/blocks`, () => [section(SECOND, 'The pore is the point')]);
		await reopen(SECOND);

		expect(screen()).toContain('The pore is the point');
		expect(screen()).not.toContain('The wall is the point');
	});

	it('keeps nothing for a note this device never read', async () => {
		api.on(`GET ${path(THIRD)}/blocks`, () => {
			throw new Error('nothing is listening');
		});
		await openNote(THIRD);

		expect(screen()).toContain('Close it and open it again');
	});
});

// PRODUCT.md § "The peer": what somebody pulled is what they answer, so a note
// they hold is one their own writing may point at.
describe('citing a note held from somebody else', () => {
	const PEER = 'did:syr:z6MkpTHR8VNsBxYAAWHut2Geadd9jSLuFvdmsZ2mFmZjMxYZ';
	const REGION = `${DID}/${ulid(70)}` as OwnedRef;
	const THEIRS = ref(71, PEER);

	const region: PullView = {
		ref: REGION,
		created_by: DID,
		publication: ref(72, PEER),
		version: { ref: ref(73, PEER), sequence: 1, published_at: AT },
		root_address: '1',
		graph_title: 'Their notebook',
		comments: 'anyone',
		source_url: 'http://peer.test',
		created_at: AT,
		updated_at: AT
	};

	const ADA: ProfileView = {
		did: PEER,
		username: 'ada',
		display_name: 'Ada Lovelace',
		bio: null,
		avatar_src: null,
		banner_src: null
	};

	/** A note out of that region: addressed by its AUTHOR, as every held one is. */
	function theirs(over: Partial<NodeView> = {}): NodeView {
		return {
			...node(71, '1a', { title: 'Ash keys' }),
			ref: THEIRS,
			created_by: PEER,
			origin: THEIRS,
			published: true,
			...over
		};
	}

	let graph: Map<OwnedRef, NodeView>;
	let held: NodeView;

	beforeEach(async () => {
		session.adopt(VIEWER, 'a-session');
		held = theirs();
		api.on('GET /following', () => []);
		api.on('GET /pulls', () => [region]);
		api.on(`GET /pulls${refPath(REGION)}/nodes`, () => [held]);
		api.on(`GET /profile/${encodeURIComponent(PEER)}`, () => ADA);
		graph = installGraph();
		await loadGraph();
	});

	// One person keeps several notebooks, so the name alone would read the same
	// for two of them.
	it('offers it to link to, named by whoever wrote it and the notebook it is in', async () => {
		await openNote(SECOND);
		await findToLink('ash');
		await until(() => offered().includes('Ada Lovelace'));

		expect(offered()).toContain('Ash keys');
		expect(offered()).toContain('Ada Lovelace · Their notebook');
	});

	it('names the person alone where the notebook arrived without a name', async () => {
		const unnamed: PullView = { ...region };
		delete unnamed.graph_title;
		api.on('GET /pulls', () => [unnamed]);
		await openNote(SECOND);
		await findToLink('ash');
		await until(() => offered().includes('Ada Lovelace'));

		expect(offered()).not.toContain('·');
	});

	// Nobody's name is a fallback for their identity: what stands in is the
	// notebook the copy arrived under.
	it('names the notebook where nobody here can say who wrote it', async () => {
		api.on(`GET /profile/${encodeURIComponent(PEER)}`, () => {
			throw new Error('unreachable');
		});
		await openNote(SECOND);
		await findToLink('ash');
		await until(() => offered().includes('Ash keys'));

		expect(offered()).toContain('Their notebook');
		expect(offered()).not.toContain(PEER);
	});

	it('resolves a link pointing at it rather than calling it gone', async () => {
		graph.set(SECOND, { ...graph.get(SECOND)!, links: [THEIRS] });
		nodes.clear();
		await loadGraph();
		await openNote(SECOND);
		await until(() => screen().includes('Ash keys'));

		expect(screen()).toContain('Links to');
		expect(screen()).not.toContain('A note that is no longer here.');
	});

	it('shows a held note that points back at this one', async () => {
		held = theirs({ links: [SECOND] });
		await openNote(SECOND);
		await until(() => screen().includes('Ada Lovelace'));

		expect(screen()).toContain('Linked from');
		expect(labelled('1a Ash keys, in Ada Lovelace · Their notebook')).toBeTruthy();
	});
});

// PRODUCT.md principle 3: an address is read inside one graph, so the note that
// carries it says which the moment a note from another one is open beside it.
describe('which graph the note at the head is read in', () => {
	const GARDEN = ref(50);
	const COMPOST = node(51, '1', { title: 'Compost', graph: GARDEN });

	async function openBeside(...alsoOpen: OwnedRef[]): Promise<void> {
		stubViewport(WIDE);
		mounted = mount(Note, {
			target,
			props: {
				ref: SECOND,
				openNotes: [SECOND, ...alsoOpen],
				onWrite: () => {},
				onOpen: () => {},
				onLinkOnGraph: () => {},
				onDeleted: () => {},
				onClose: () => {}
			}
		});
		flushSync();
		await settle();
	}

	beforeEach(async () => {
		graphs.clear();
		installGraph();
		api.on('GET /graphs', () => [
			{ ref: homeGraphRef(DID), created_by: DID, created_at: AT, updated_at: AT, title: 'Biology' },
			{ ref: GARDEN, created_by: DID, created_at: AT, updated_at: AT, title: 'Garden' }
		]);
		api.on(`GET ${path(COMPOST.ref)}`, () => COMPOST);
		api.on(`GET ${path(COMPOST.ref)}/blocks`, () => []);
		await graphs.load();
		await loadGraph();
		await nodes.fetch(COMPOST.ref);
	});

	afterEach(() => graphs.clear());

	it('names no graph while every open note is in this one', async () => {
		await openBeside(FIRST);

		expect(noteHead()).not.toContain('Biology');
		expect(labelled('Copy the address 1a')).toBeTruthy();
	});

	it('names this one once a note from another graph is open beside it', async () => {
		await openBeside(COMPOST.ref);

		expect(noteHead()).toContain('Biology');
		expect(labelled('Copy the address 1a, in Biology')).toBeTruthy();
	});
});

// PRODUCT.md principle 3: the address is what a person cites and a peer
// resolves, so both have to have a way out of the app.
describe('handing a note to somebody', () => {
	let copied: string[];

	function clipboardAnswers(writeText: (text: string) => Promise<void>): void {
		Object.defineProperty(globalThis.navigator, 'clipboard', {
			configurable: true,
			value: { writeText }
		});
	}

	const menuReads = (label: string): boolean =>
		[...document.body.querySelectorAll('button')].some((b) => b.textContent?.trim() === label);

	beforeEach(async () => {
		copied = [];
		clipboardAnswers((text) => {
			copied.push(text);
			return Promise.resolve();
		});
		graphs.clear();
		installGraph();
		await loadGraph();
	});

	afterEach(() => {
		Reflect.deleteProperty(globalThis.navigator, 'clipboard');
		Reflect.deleteProperty(globalThis.navigator, 'share');
	});

	it('copies the address under the name of the graph it is read in', async () => {
		api.on('GET /graphs', () => [
			{ ref: homeGraphRef(DID), created_by: DID, created_at: AT, updated_at: AT, title: 'Biology' }
		]);
		await graphs.load();
		await openNote(SECOND);

		labelled('Copy the address 1a').click();
		await settle();

		expect(copied).toEqual(['1a · Biology']);
		expect(noteHead()).toContain('Address copied.');
	});

	it('copies a link a peer can open', async () => {
		await openNote(SECOND);
		await act('Copy link');

		expect(copied).toEqual([`${globalThis.location.origin}${nodeHref(SECOND)}`]);
		expect(noteHead()).toContain('Link copied.');
	});

	it('says so rather than pretending, where the clipboard will not take it', async () => {
		clipboardAnswers(() => Promise.reject(new Error('refused')));
		await openNote(SECOND);
		await act('Copy link');

		expect(noteHead()).toContain('Sloppy could not copy that.');
	});

	it('offers no share where the platform has no sheet for one', async () => {
		await openNote(SECOND);
		labelled('What to do with this note').click();
		await settle();

		expect(menuReads('Copy link')).toBe(true);
		expect(menuReads('Share')).toBe(false);
	});

	it('hands the link to the sheet where the platform has one', async () => {
		const shared: { url?: string }[] = [];
		Object.defineProperty(globalThis.navigator, 'share', {
			configurable: true,
			value: (data: { url?: string }) => {
				shared.push(data);
				return Promise.resolve();
			}
		});
		await openNote(SECOND);
		await act('Share');

		expect(shared).toEqual([
			{ url: `${globalThis.location.origin}${nodeHref(SECOND)}`, title: 'Cells' }
		]);
		expect(copied).toEqual([]);
	});

	it('copies the link where the sheet will not take it', async () => {
		Object.defineProperty(globalThis.navigator, 'share', {
			configurable: true,
			value: () => Promise.reject(new Error('no sheet here'))
		});
		await openNote(SECOND);
		await act('Share');

		expect(copied).toEqual([`${globalThis.location.origin}${nodeHref(SECOND)}`]);
	});
});
