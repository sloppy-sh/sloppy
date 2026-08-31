import type { NodeView, OwnedRef } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { node, ref, useFakeApi, type FakeApi } from '../stores/fake-api.test-support.js';
import { nodes } from '../stores/nodes.svelte.js';
import { session } from '../stores/session.svelte.js';
import { tags } from '../stores/tags.svelte.js';
import { at, back, forward, pushed, replaced, startAt } from './page.test-support.svelte.js';
import { nodeHref } from './routes.js';

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

const PHONE = 390;
const TABLET = 834;
const DESK = 1280;

const FIRST = ref(1);
const SECOND = ref(2);
const THIRD = ref(3);
/** Under `1` alongside the two above, so a suite can fill the strip. */
const MORE = [ref(4), ref(5), ref(6), ref(7)];
const EVERY = [FIRST, SECOND, THIRD, ...MORE];

let api: FakeApi;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

function path(of: OwnedRef): string {
	const cut = of.lastIndexOf('/');
	return `/nodes/${encodeURIComponent(of.slice(0, cut))}/${encodeURIComponent(of.slice(cut + 1))}`;
}

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
		[THIRD, node(3, '1b', { title: 'Tissue', origin: FIRST, parent: FIRST })],
		...MORE.map(
			(of, at) =>
				[
					of,
					node(at + 4, `1${'cdef'[at]}`, { title: 'Later', origin: FIRST, parent: FIRST })
				] as const
		)
	]);
	api.on('GET /nodes/tags', () => []);
	api.on('GET /nodes', (url) => {
		const origin = url.searchParams.get('origin');
		return [...held.values()].filter((n) => (origin ? n.origin === origin : n.ref === n.origin));
	});
	for (const of of EVERY) {
		api.on(`GET ${path(of)}`, () => held.get(of) ?? null);
		api.on(`GET ${path(of)}/blocks`, () => []);
		api.on(`PATCH ${path(of)}`, (_url, init) => {
			const note = held.get(of);
			if (!note) return null;
			const written = { ...note, ...(JSON.parse(String(init?.body ?? '{}')) as Partial<NodeView>) };
			held.set(of, written);
			return written;
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

const screen = () => document.body.textContent ?? '';

/** The note's own surface, whichever way it is presented. */
function surface(): HTMLElement {
	const found = document.body.querySelector<HTMLElement>('aside, [role="dialog"]');
	if (!found) throw new Error('The note is not on screen');
	return found;
}

/** The title as the reader would read it, out of the field they retitle it in. */
function titled(): string {
	const field = surface().querySelector<HTMLTextAreaElement>('[aria-label="Title"]');
	if (!field) throw new Error('The note has no title to read');
	return field.value;
}

/** Types over the title of whichever note is on screen. */
function retitle(to: string): void {
	const field = surface().querySelector<HTMLTextAreaElement>('[aria-label="Title"]');
	if (!field) throw new Error('The note has no title to write');
	field.value = to;
	field.dispatchEvent(new Event('input', { bubbles: true }));
}

/** One of the ways along the run at the foot of a note, by what it says. */
function way(says: string): HTMLButtonElement {
	const found = surface().querySelector<HTMLButtonElement>(`[aria-label^="${says}"]`);
	if (!found) throw new Error(`The note offers no way to "${says}"`);
	return found;
}

/** What the tag field invites, which says whether it is on screen at all. */
function tagInvite(): string {
	const field = surface().querySelector<HTMLInputElement>('input[role="combobox"]');
	if (!field) throw new Error('The note has no tag field');
	return field.placeholder;
}

/** The canvas's menu, asked for on the bare field. */
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

/** What `<html>` is currently told the docked note takes. */
const dockInset = () =>
	document.documentElement.style.getPropertyValue('--reading-dock-inset-right');

function button(labelled: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].find((b) =>
		b.textContent?.includes(labelled)
	);
	if (!found) throw new Error(`No "${labelled}" button on screen`);
	return found;
}

async function openGraph(width: number, from = '/'): Promise<void> {
	startAt(from);
	stubViewport(width);
	mounted = mount(Graph, { target });
	flushSync();
	await settle();
}

async function readCells(width: number): Promise<void> {
	await openGraph(width);
	onCanvas('1a').click();
	await settle();
}

/** The strip across the head of the panel, and nothing where it is not drawn. */
function strip(): HTMLElement | null {
	return document.body.querySelector<HTMLElement>('[aria-label="Open notes"]');
}

/** One tab, by the address it carries. */
function tab(address: string): HTMLButtonElement {
	const found = [...(strip()?.querySelectorAll('button') ?? [])].find(
		(b) => b.querySelector('.address')?.textContent === address
	);
	if (!found) throw new Error(`No tab for ${address} is on the strip`);
	return found as HTMLButtonElement;
}

/** The control that closes one tab, by the address it names. */
function closeTab(address: string): HTMLButtonElement {
	const found = strip()?.querySelector<HTMLButtonElement>(`[aria-label="Close ${address}"]`);
	if (!found) throw new Error(`No way to close ${address} is on the strip`);
	return found;
}

/** The addresses on the strip, in order, and which one is being read. */
function openTabs(): { addresses: string[]; reading: string | undefined } {
	const marks = [...(strip()?.querySelectorAll('.address') ?? [])];
	return {
		addresses: marks.map((mark) => mark.textContent ?? ''),
		reading: marks
			.find((mark) => mark.closest('button')?.getAttribute('aria-current') === 'page')
			?.textContent?.trim()
	};
}

/** What the canvas is lifting: which marks are open, and which is being read. */
function lifted(): Record<string, string> {
	const marks = [
		...document.body.querySelectorAll<HTMLElement>('[aria-label="The graph"] [data-lifted]')
	];
	return Object.fromEntries(
		marks.map((mark) => [mark.textContent?.trim().split(/\s+/)[0] ?? '', mark.dataset.lifted ?? ''])
	);
}

/** Opens `address` beside whatever is already open, through the canvas menu —
 *  the one way in a finger has, and the one a mouse has. */
async function alsoOpen(address: string): Promise<void> {
	menuOn(address).click();
	await settle();
	item('Open it as well').click();
	await settle();
}

beforeEach(() => {
	nodes.clear();
	tags.clear();
	api = useFakeApi();
	installGraph();
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

// The point of the wave: a note is somewhere to read and work, so a phone must
// not be given a shorter product than a desk, nor a desk than a phone.
describe.each([
	['on a phone', PHONE],
	['on a tablet', TABLET],
	['at desk width', DESK]
])('what a note opens with, %s', (_where, width) => {
	it('carries its address, its title, and every act on it', async () => {
		await readCells(width);

		const note = surface().textContent ?? '';
		expect(note).toContain('1a');
		expect(titled()).toBe('Cells');
		expect(tagInvite()).toBe('Tag this note');
		expect(note).toContain('How this note looks');
		expect(note).toContain('Write a note under this');
		expect(note).toContain('Write the next note');
		expect(note).toContain('Link to another note');
		expect(note).toContain('Delete this note');
	});

	it('goes back to the graph by the way out it opens on', async () => {
		await readCells(width);

		button('Graph').click();
		await settle();

		expect(screen()).not.toContain('Delete this note');
		expect(at.path).toBe('/');
	});
});

describe('a note beside the graph', () => {
	it('leaves the canvas standing where there is room for both', async () => {
		await readCells(DESK);

		// No scrim between the reader and the field: the graph is still drawn,
		// still says what it holds, and still answers a tap on another note.
		expect(document.body.querySelector('[aria-label="The graph"]')).not.toBeNull();
		expect(screen()).toContain('New branch');

		onCanvas('1').click();
		await settle();

		expect(titled()).toBe('Origins');
	});

	it('does not stand over the graph on a phone', async () => {
		await readCells(PHONE);

		expect(surface().getAttribute('role')).toBe('dialog');
	});

	it('closes on Escape, and the graph is what is left', async () => {
		await readCells(DESK);

		surface().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await settle();

		expect(screen()).not.toContain('Delete this note');
		expect(document.body.querySelector('[aria-label="The graph"]')).not.toBeNull();
	});
});

describe('the note in the address bar', () => {
	it('names the note it opened, and Back leaves the graph standing', async () => {
		await readCells(DESK);
		expect(at.path).toBe(nodeHref(SECOND));

		back();
		await settle();

		expect(at.note).toBeNull();
		expect(screen()).not.toContain('Delete this note');
		expect(document.body.querySelector('[aria-label="The graph"]')).not.toBeNull();
	});

	// The note is reached by its address and nowhere else on a cold load, so the
	// panel has to open from the URL rather than from the tap that usually opens it.
	it('opens the note the reader arrived on', async () => {
		await openGraph(DESK, nodeHref(SECOND));

		expect(titled()).toBe('Cells');
		expect(at.note).toBe(SECOND);
	});
});

// The panel is beside the graph, not over it, so the graph goes on being the
// graph: it keeps every mode it had, and it is told the box it has left.
describe('the graph beside an open note', () => {
	it('ends choosing on Escape, the way it does with nothing open', async () => {
		await readCells(DESK);

		menuOn('the canvas').click();
		await settle();
		item('Choose notes').click();
		await settle();
		expect(screen()).toContain('Tap the notes you mean');

		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		await settle();

		expect(screen()).not.toContain('Tap the notes you mean');
		expect(titled()).toBe('Cells');
	});

	it('hears its box change when the note takes the width and when it gives it back', async () => {
		await openGraph(DESK);
		let told = 0;
		const heard = () => (told += 1);
		window.addEventListener('resize', heard);
		try {
			onCanvas('1a').click();
			await settle();
			expect(dockInset()).not.toBe('');
			expect(told).toBeGreaterThan(0);

			const settled = told;
			button('Graph').click();
			await settle();
			expect(dockInset()).toBe('');
			expect(told).toBeGreaterThan(settled);
		} finally {
			window.removeEventListener('resize', heard);
		}
	});

	it('takes the focus back where the note was opened from', async () => {
		await openGraph(DESK);
		const mark = onCanvas('1a');
		mark.focus();
		mark.click();
		await settle();
		expect(surface().contains(document.activeElement)).toBe(true);

		button('Graph').click();
		await settle();

		expect(document.activeElement).toBe(mark);
	});
});

// Several related notes worked across at once. The phone gets every one of
// these, by the press and hold the canvas already answers — a desk does not get
// a way in that a finger has not got.
describe.each([
	['on a phone', PHONE],
	['at desk width', DESK]
])('a few notes open at once, %s', (_where, width) => {
	it('draws no strip until there is somewhere to switch to', async () => {
		await readCells(width);
		expect(strip()).toBeNull();

		await alsoOpen('1b');

		expect(openTabs()).toEqual({ addresses: ['1a', '1b'], reading: '1b' });
	});

	it('replaces the note being read when one is opened plainly', async () => {
		await readCells(width);
		await alsoOpen('1b');

		onCanvas('1').click();
		await settle();

		expect(openTabs()).toEqual({ addresses: ['1a', '1'], reading: '1' });
		expect(titled()).toBe('Origins');
	});

	it('switches between them without losing what was typed into one', async () => {
		await readCells(width);
		await alsoOpen('1b');
		retitle('Tissue, half-written');
		await settle();

		tab('1a').click();
		await settle();
		expect(titled()).toBe('Cells');

		tab('1b').click();
		await settle();
		expect(titled()).toBe('Tissue, half-written');
	});

	// A title that would not save stays on the note it was typed into, with the
	// words that say so — neither may follow the reader to the next tab.
	it('keeps a title that would not save on the note it belongs to', async () => {
		api.on(`PATCH ${path(THIRD)}`, () => {
			throw new Error('nope');
		});
		await readCells(width);
		await alsoOpen('1b');
		retitle('Tissue, half-written');
		await settle();

		tab('1a').click();
		await settle();
		expect(titled()).toBe('Cells');
		expect(surface().textContent).not.toContain('could not save that title');

		tab('1b').click();
		await settle();
		expect(titled()).toBe('Tissue, half-written');
		expect(surface().textContent).toContain('could not save that title');
	});

	// The bug this is written against shipped once: a read that failed was
	// remembered against the wrong note and made it permanently unreadable.
	it('keeps a note that would not read from marking the one beside it', async () => {
		api.on(`GET ${path(THIRD)}/blocks`, () => {
			throw new Error('nope');
		});
		await readCells(width);
		await alsoOpen('1b');
		expect(screen()).toContain('Sloppy could not read this note');

		tab('1a').click();
		await settle();

		expect(screen()).not.toContain('Sloppy could not read this note');
		expect(titled()).toBe('Cells');
	});

	// A walk is a walk: it moves the reader along the run, and does not quietly
	// fill the strip with every note they passed through.
	it('walks the run inside the tab it started in', async () => {
		await readCells(width);
		await alsoOpen('1b');
		tab('1a').click();
		await settle();

		way('The note this one grew out of').click();
		await settle();

		expect(openTabs()).toEqual({ addresses: ['1', '1b'], reading: '1' });
	});

	it('leaves the reader on the note beside the one they closed', async () => {
		await readCells(width);
		await alsoOpen('1b');

		closeTab('1b').click();
		await settle();

		expect(strip()).toBeNull();
		expect(titled()).toBe('Cells');
		expect(at.path).toBe(nodeHref(SECOND));

		button('Graph').click();
		await settle();
		expect(screen()).not.toContain('Delete this note');
		expect(at.path).toBe('/');
	});

	// A strip nobody can find a note on has stopped being a strip.
	it('says how many can be open once the strip is full', async () => {
		await readCells(width);
		for (const address of ['1b', '1c', '1d', '1e', '1f']) await alsoOpen(address);
		expect(openTabs().addresses).toHaveLength(6);

		menuOn('1').click();
		await settle();
		item('Open it as well').click();
		await settle();

		expect(screen()).toContain('You can have 6 notes open at once. Close one to open another.');
		expect(openTabs().addresses).toHaveLength(6);
		expect(at.path).toBe(nodeHref(ref(7)));
	});
});

describe('the graph beside a few open notes', () => {
	it('says which marks are open and which one is in front of the reader', async () => {
		await readCells(DESK);
		await alsoOpen('1b');
		await alsoOpen('1');

		expect(lifted()).toEqual({ '1a': 'open', '1b': 'open', '1': 'reading' });

		tab('1a').click();
		await settle();
		expect(lifted()).toEqual({ '1a': 'reading', '1b': 'open', '1': 'open' });
	});

	it('says nothing about a note nobody has open', async () => {
		await openGraph(DESK);
		expect(lifted()).toEqual({});
	});
});

// Which notes are open rides in the history entry beside the active one, so a
// pop can never leave the strip disagreeing with the address bar.
describe('going back and forward across the open notes', () => {
	it('lands on the note the address bar names, with the strip it had', async () => {
		await readCells(DESK);
		await alsoOpen('1b');
		expect(at.path).toBe(nodeHref(THIRD));

		back();
		await settle();
		expect(at.path).toBe(nodeHref(SECOND));
		expect(strip()).toBeNull();
		expect(titled()).toBe('Cells');

		forward();
		await settle();
		expect(openTabs()).toEqual({ addresses: ['1a', '1b'], reading: '1b' });
		expect(titled()).toBe('Tissue');
	});

	it('closes the surface on the way back past the first note', async () => {
		await readCells(DESK);
		await alsoOpen('1b');

		back();
		await settle();
		back();
		await settle();

		expect(at.note).toBeNull();
		expect(screen()).not.toContain('Delete this note');
		expect(lifted()).toEqual({});
	});
});
