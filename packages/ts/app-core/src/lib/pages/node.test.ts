import type { NodeView, OwnedRef } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nodes } from '../stores/nodes.svelte.js';
import { node, ref, useFakeApi, type FakeApi } from '../stores/fake-api.test-support.js';
import NoteInModal from './note-in-modal.test-support.svelte';

const FIRST = ref(1);
const SECOND = ref(2);
const THIRD = ref(3);
const FOURTH = ref(4);

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

async function openNote(at: OwnedRef, onclose?: () => void): Promise<void> {
	stubViewport(WIDE);
	mounted = mount(NoteInModal, { target, props: { opened: at, fresh: false, onclose } });
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

/** Only the search results, so the note's own lists cannot answer for them. */
const offered = () =>
	document.body.querySelector('[aria-label="Notes you can link to"]')?.textContent ?? '';

async function findToLink(typed: string): Promise<void> {
	button('Link to another note').click();
	await settle();
	const field = document.body.querySelector<HTMLInputElement>(
		'[aria-label="Find a note to link to"]'
	);
	if (!field) throw new Error('The note search never opened');
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
		await openNote(FIRST, closed);
		button('Delete this note').click();
		await settle();
		exactly('Delete').click();
		await settle();
		await settle();

		expect(closed).toHaveBeenCalled();
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
