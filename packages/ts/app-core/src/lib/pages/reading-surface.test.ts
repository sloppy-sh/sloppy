import type { NodeView, OwnedRef } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { node, ref, useFakeApi, VIEWER, type FakeApi } from '../stores/fake-api.test-support.js';
import { graphs } from '../stores/graphs.svelte.js';
import { nodes } from '../stores/nodes.svelte.js';
import { prefs } from '../stores/prefs.svelte.js';
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

const Graph = (await import('./graph-in-chrome.test-support.svelte')).default;

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

/** jsdom lays nothing out, so what a surface measures itself with is supplied:
 *  a box stands one row tall per thing in it — a figure of no significance, so
 *  that what is asserted is the counting — and the observers that would answer a
 *  reflow are told to look again by `settle`. */
const ROW = 37;
const laidOut = new Set<(entries: unknown[]) => void>();
const noLayout = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
const roomless = Object.getOwnPropertyDescriptor(window, 'innerWidth');

function stubViewport(width: number): void {
	// The panel bounds the room it takes against the window itself, not against a
	// query, so a stubbed viewport that only answered `matchMedia` would leave it
	// sizing to a window nothing else in the suite is at.
	Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
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
			look: (entries: unknown[]) => void;
			constructor(look: (entries: unknown[]) => void) {
				this.look = look;
				laidOut.add(look);
			}
			observe() {}
			unobserve() {}
			disconnect() {
				laidOut.delete(this.look);
			}
		}
	});
	Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
		configurable: true,
		get(this: HTMLElement) {
			return this.children.length * ROW;
		}
	});
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 6; turn += 1) {
		await new Promise((done) => setTimeout(done, 0));
		flushSync();
	}
	for (let frame = 0; frame < 3; frame += 1) await new Promise(requestAnimationFrame);
	for (const look of laidOut) look([]);
	flushSync();
}

function installGraph(): Map<OwnedRef, NodeView> {
	const held = new Map<OwnedRef, NodeView>([
		[FIRST, node(1, '1', { title: 'Origins' })],
		// The hub of the fixture: every other note is a row inside this one, which
		// is where a reader opens a related note beside the one they are reading.
		[
			SECOND,
			node(2, '1a', {
				title: 'Cells',
				origin: FIRST,
				parent: FIRST,
				links: [FIRST, THIRD, ...MORE]
			})
		],
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
		api.on(`DELETE ${path(of)}`, () => {
			for (const [key, note] of held) {
				if (key === of || note.parent === of) held.delete(key);
			}
			return undefined;
		});
	}
	return held;
}

/** An answer the suite holds open, so something else can happen while an act is
 *  still in the air — a tab switched away from under it. */
function heldOpen<T>(): { answer: (value: T) => void; route: () => Promise<T> } {
	let give: (value: T) => void = () => {};
	const waiting = new Promise<T>((settle) => (give = settle));
	return { answer: (value: T) => give(value), route: () => waiting };
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

/** Whether a note is open on the reading surface at all. */
const reading = () => document.body.querySelector('[aria-label="Title"]') !== null;

/** Everything that is not writing waits behind one control at the head of the
 *  note, so an act is reached by opening that and picking it. */
async function act(named: string): Promise<void> {
	control('What to do with this note').click();
	await settle();
	exactly(named).click();
	await settle();
}

/** What the tag field invites, on whichever surface it was opened on. */
function tagInvite(): string {
	// The column beside the graph carries a field of its own, which is not the
	// one a note's own surface just opened.
	const field = [
		...document.body.querySelectorAll<HTMLInputElement>('input[role="combobox"]')
	].find((one) => one.closest('aside[aria-label="Sloppy"]') === null);
	if (!field) throw new Error('Nothing on screen invites a tag');
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

/** What the surface tells the note under it its own head stands at. */
const readingHead = () =>
	surface()
		.querySelector<HTMLElement>('[style*="--reading-head"]')
		?.style.getPropertyValue('--reading-head') ?? '';

/** A control inside the note, by the label it carries. */
function control(label: string): HTMLButtonElement {
	const found = surface().querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
	if (!found) throw new Error(`The note carries no "${label}"`);
	return found;
}

function exactly(text: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].find(
		(b) => b.textContent?.trim() === text
	);
	if (!found) throw new Error(`No button on screen reads exactly "${text}"`);
	return found;
}

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

/** Opens `address` beside whatever is already open, from the row inside the note
 *  that names it. On a phone the surface stands over the canvas, so this is the
 *  only way in a finger has — and it is the same one at desk width. */
async function alsoOpen(address: string): Promise<void> {
	const found = surface().querySelector<HTMLButtonElement>(
		`[aria-label="Open ${address} as well"]`
	);
	if (!found) throw new Error(`The note on screen names no ${address} to open as well`);
	found.click();
	await settle();
}

/** The box the note scrolls in. jsdom applies no stylesheet, so the surface's
 *  own overflow class computes as `visible` and has to be spelled out here. */
function noteBox(): HTMLElement {
	const field = surface().querySelector<HTMLElement>('[aria-label="Title"]');
	const box = field?.closest<HTMLElement>('.mx-auto')?.parentElement?.parentElement;
	if (!box) throw new Error('The note is in nothing that scrolls');
	box.style.overflowY = 'auto';
	return box;
}

/** jsdom lays nothing out and has no `scrollIntoView`, so what the strip asks to
 *  be brought into view is recorded instead. The geometry is the browser's. */
const scrolling = vi.fn();

/** Whether the last thing brought into view was one tab, named by its address. */
function broughtIntoView(address: string): boolean {
	const last = scrolling.mock.contexts.at(-1);
	return last instanceof Element && last.contains(tab(address));
}

beforeEach(() => {
	nodes.clear();
	tags.clear();
	graphs.clear();
	api = useFakeApi();
	session.adopt(VIEWER, 'a-session');
	installGraph();
	scrolling.mockClear();
	Element.prototype.scrollIntoView = scrolling;
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	session.clear();
	target.remove();
	document.body.innerHTML = '';
	laidOut.clear();
	if (noLayout) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', noLayout);
	if (roomless) Object.defineProperty(window, 'innerWidth', roomless);
});

// The point of the wave: a note is somewhere to read and work, so a phone must
// not be given a shorter product than a desk, nor a desk than a phone.
describe.each([
	['on a phone', PHONE],
	['on a tablet', TABLET],
	['at desk width', DESK]
])('what a note opens with, %s', (_where, width) => {
	it('carries its address, its title, and the acts that write', async () => {
		await readCells(width);

		const note = surface().textContent ?? '';
		expect(note).toContain('1a');
		expect(titled()).toBe('Cells');
		expect(note).toContain('Write a note under this');
		expect(note).toContain('Write the next note');
	});

	// A re-ranking, not a removal: what a reader does to a note occasionally is
	// still all there, one control away, on a phone as at a desk.
	it('holds everything else behind the one control at its head', async () => {
		await readCells(width);

		control('What to do with this note').click();
		await settle();

		const menu = screen();
		expect(menu).toContain('Tags');
		expect(menu).toContain('Link to another note');
		expect(menu).toContain('Delete this note');
	});

	// How a note is drawn is a side of the note rather than an occasional act,
	// so it is on the surface at every width and never behind that control.
	it('carries how the note is drawn as a side of it', async () => {
		await readCells(width);

		const look = [...surface().querySelectorAll('[role="tab"]')].find(
			(tab) => tab.textContent?.trim() === 'Look'
		);
		expect(look).toBeTruthy();
	});

	it('reaches the tags on this note from there', async () => {
		await readCells(width);

		await act('Tags');

		expect(tagInvite()).toBe('Tag this note');
	});

	it('goes back to the graph by the way out it opens on', async () => {
		await readCells(width);

		button('Graph').click();
		await settle();

		expect(reading()).toBe(false);
		expect(at.path).toBe('/');
	});
});

describe('a note beside the graph', () => {
	it('leaves the canvas standing where there is room for both', async () => {
		await readCells(DESK);

		// No scrim between the reader and the field: the graph is still drawn,
		// still says what it holds, and still answers a tap on another note.
		expect(document.body.querySelector('[aria-label="The graph"]')).not.toBeNull();
		expect(screen()).toContain('New note');

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

		expect(reading()).toBe(false);
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
		expect(reading()).toBe(false);
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
		expect(screen()).toContain('Pick the notes you mean');

		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		await settle();

		expect(screen()).not.toContain('Pick the notes you mean');
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

	// The canvas is the other way in, wherever a mark can be reached at all.
	it('opens a mark beside the note being read, from its menu', async () => {
		await readCells(DESK);

		menuOn('1b').click();
		await settle();
		item('Open it as well').click();
		await settle();

		expect(openTabs()).toEqual({ addresses: ['1a', '1b'], reading: '1b' });
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
// these, through the rows inside a note — a desk does not get a way in that a
// finger has not got, and on a phone the canvas is behind the surface.
describe.each([
	['on a phone', PHONE],
	['on a tablet', TABLET],
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

	// A refusal that answers an act the reader has walked away from has nothing
	// left to tell them, and repeating it at a note they came back to is how a
	// surface teaches people to read past what it says.
	it('does not repeat a delete that failed at a note the reader comes back to', async () => {
		api.on(`DELETE ${path(THIRD)}`, () => {
			throw new Error('nope');
		});
		await readCells(width);
		await alsoOpen('1b');

		await act('Delete this note');
		exactly('Delete').click();
		await settle();
		// The question stays standing with the answer on it, so the reader who
		// asked reads it; dismissing it leaves the answer at the head of the note.
		expect(screen()).toContain('could not delete that note');
		exactly('Cancel').click();
		await settle();
		expect(surface().textContent).toContain('could not delete that note');

		tab('1a').click();
		await settle();
		tab('1b').click();
		await settle();

		expect(surface().textContent).not.toContain('could not delete that note');
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
		expect(reading()).toBe(false);
		expect(at.path).toBe('/');
	});

	it('comes back to a tab where the reader left off in it', async () => {
		await readCells(width);
		await alsoOpen('1b');
		tab('1a').click();
		await settle();

		const box = noteBox();
		box.scrollTop = 420;

		tab('1b').click();
		await settle();
		expect(box.scrollTop, 'a note opened for the first time starts at its top').toBe(0);

		tab('1a').click();
		await settle();
		expect(box.scrollTop).toBe(420);
	});

	// A walk is somewhere new; the note it leaves is the note it leaves.
	it('starts a note the reader walked to at its top', async () => {
		await readCells(width);
		const box = noteBox();
		box.scrollTop = 420;

		way('The note this one grew out of').click();
		await settle();

		expect(box.scrollTop).toBe(0);
	});

	// The strip scrolls sideways, and six tabs fit neither a phone nor a desk. A
	// tab opened past its edge is open with nothing on screen to say so.
	it('brings the tab it is reading into the strip', async () => {
		await readCells(width);
		scrolling.mockClear();
		await alsoOpen('1b');
		expect(broughtIntoView('1b')).toBe(true);

		scrolling.mockClear();
		tab('1a').click();
		await settle();

		expect(broughtIntoView('1a')).toBe(true);
	});

	// A strip nobody can find a note on has stopped being a strip.
	it('says how many can be open once the strip is full', async () => {
		await readCells(width);
		for (const address of ['1b', '1c', '1d', '1e', '1f']) {
			await alsoOpen(address);
			tab('1a').click();
			await settle();
		}
		expect(openTabs().addresses).toHaveLength(6);

		await alsoOpen('1');

		expect(screen()).toContain('You can have 6 notes open at once. Close one to open another.');
		expect(openTabs().addresses).toHaveLength(6);
		expect(at.path).toBe(nodeHref(SECOND));
	});

	// The note under it sticks its own head below the surface's, so what the
	// surface publishes has to be the whole of its head — DESIGN.md § "The four
	// inset vars". A refusal drawn beside the strip and a height that counted
	// only the strip is a message painted over the way out of the note.
	it('tells the note how tall its head really stands', async () => {
		await readCells(width);
		await alsoOpen('1b');
		expect(readingHead(), 'the strip on its own').toBe(`${ROW}px`);

		for (const address of ['1c', '1d', '1e', '1f']) {
			tab('1a').click();
			await settle();
			await alsoOpen(address);
		}
		tab('1a').click();
		await settle();
		await alsoOpen('1');

		expect(screen()).toContain('Close one to open another');
		expect(readingHead(), 'the strip and what it says beside it').toBe(`${ROW * 2}px`);
	});

	// A refusal that outlives the act it asks for teaches people to read past it.
	it('takes the message down once a note has been closed', async () => {
		await readCells(width);
		for (const address of ['1b', '1c', '1d', '1e', '1f']) {
			await alsoOpen(address);
			tab('1a').click();
			await settle();
		}
		await alsoOpen('1');
		expect(screen()).toContain('Close one to open another');

		closeTab('1f').click();
		await settle();

		expect(screen()).not.toContain('Close one to open another');
	});

	// The graph is asked which note to link to, so the surface steps out of its
	// way — and the notes on it are not what the reader paid for the question.
	it('keeps every note open while the graph is asked what to link to', async () => {
		await readCells(width);
		await alsoOpen('1b');

		await act('Link to another note');
		button('Point at it on the graph').click();
		await settle();
		expect(screen()).toContain('Tap a note to link it to');

		button('Never mind').click();
		await settle();

		expect(openTabs()).toEqual({ addresses: ['1a', '1b'], reading: '1b' });
	});

	it('keeps them open when the link lands, too', async () => {
		await readCells(width);
		await alsoOpen('1b');

		await act('Link to another note');
		button('Point at it on the graph').click();
		await settle();
		onCanvas('1').click();
		await settle();

		expect(openTabs()).toEqual({ addresses: ['1a', '1b'], reading: '1b' });
	});
});

// Look stands beside the note rather than over it, so the note is hidden while
// it is in front and a browser has nothing left to scroll.
describe('looking at how a note is drawn, and going back to reading it', () => {
	let laidOutAgain: MutationObserver | undefined;
	afterEach(() => laidOutAgain?.disconnect());

	/** jsdom lays nothing out, so a box keeps whatever `scrollTop` it is handed
	 *  however short its content has become. A browser holds it to what is left to
	 *  scroll the moment the note collapses, and forgets the rest — which is what
	 *  takes a reader's place away behind Look. */
	function clamps(box: HTMLElement): void {
		let at = 0;
		const room = () => {
			const note = document.body.querySelector('[data-slot="tabs-content"][data-value="note"]');
			return note && !note.hasAttribute('hidden') ? 4000 : 0;
		};
		Object.defineProperty(box, 'scrollTop', {
			configurable: true,
			get: () => at,
			set: (to: number) => (at = Math.max(0, Math.min(to, room())))
		});
		laidOutAgain = new MutationObserver(() => (at = Math.min(at, room())));
		laidOutAgain.observe(document.body, {
			subtree: true,
			attributes: true,
			attributeFilter: ['hidden']
		});
	}

	it('leaves the reader where they were in the note', async () => {
		await readCells(PHONE);
		const box = noteBox();
		clamps(box);
		box.scrollTop = 3000;

		exactly('Look').click();
		await settle();
		exactly('Note').click();
		await settle();

		expect(box.scrollTop).toBe(3000);
	});

	// A note the reader walked away from while looking at its look is a note they
	// left where they were reading it, not where Look was scrolled to.
	it('keeps that place across a walk to another note and back', async () => {
		await readCells(PHONE);
		await alsoOpen('1b');
		tab('1a').click();
		await settle();

		const box = noteBox();
		clamps(box);
		box.scrollTop = 3000;
		exactly('Look').click();
		await settle();

		tab('1b').click();
		await settle();
		tab('1a').click();
		await settle();

		expect(box.scrollTop).toBe(3000);
	});
});

// The server answers long after a finger has moved to another tab, and what it
// says belongs to the note the act was asked in — not to the one in front of the
// reader when it lands.
describe('an act still in the air when the reader switches tabs', () => {
	it('leaves its refusal on the tab it was asked in', async () => {
		const stalled = heldOpen<Response>();
		api.on(`PATCH ${path(SECOND)}`, () => stalled.route());
		await readCells(DESK);
		await alsoOpen('1b');
		tab('1a').click();
		await settle();

		control('Unlink 1b').click();
		await settle();
		tab('1b').click();
		await settle();
		stalled.answer(
			new Response('{"message":"That link would not go."}', {
				status: 400,
				headers: { 'content-type': 'application/json' }
			})
		);
		await settle();

		expect(surface().textContent).not.toContain('That link would not go.');

		tab('1a').click();
		await settle();
		expect(surface().textContent).toContain('That link would not go.');
	});

	it('opens a note written from one tab in that tab', async () => {
		const written = ref(8);
		const made = node(8, '1a1', { title: 'Membranes', origin: FIRST, parent: SECOND });
		const stalled = heldOpen<NodeView>();
		api.on('POST /nodes', () => stalled.route());
		api.on(`GET ${path(written)}`, () => made);
		api.on(`GET ${path(written)}/blocks`, () => []);
		await readCells(DESK);
		await alsoOpen('1b');
		tab('1a').click();
		await settle();

		button('Write a note under this').click();
		await settle();
		tab('1b').click();
		await settle();
		stalled.answer(made);
		await settle();

		expect(openTabs()).toEqual({ addresses: ['1a1', '1b'], reading: '1a1' });
	});

	// That tab can be gone by the time the note comes back, and the note in front
	// of the reader is not a stand-in for it: a slow write joins the strip rather
	// than taking somewhere they moved to.
	it('joins the strip when the tab it was written from has been closed', async () => {
		const written = ref(8);
		const made = node(8, '1a1', { title: 'Membranes', origin: FIRST, parent: SECOND });
		const stalled = heldOpen<NodeView>();
		api.on('POST /nodes', () => stalled.route());
		api.on(`GET ${path(written)}`, () => made);
		api.on(`GET ${path(written)}/blocks`, () => []);
		await readCells(DESK);
		await alsoOpen('1b');
		tab('1a').click();
		await settle();

		button('Write a note under this').click();
		await settle();
		closeTab('1a').click();
		await settle();
		stalled.answer(made);
		await settle();

		expect(openTabs()).toEqual({ addresses: ['1b', '1a1'], reading: '1a1' });
	});
});

// The panel is docked against the graph, so the room one takes is room the other
// gives up. Everything that stands beside it reads the width off `<html>` —
// DESIGN.md § "The four inset vars".
describe('taking more room to write in', () => {
	/** The wall between the note and the graph. */
	function wall(): HTMLElement {
		const found = document.body.querySelector<HTMLElement>('[role="separator"]');
		if (!found) throw new Error('The note has no wall to take room by');
		return found;
	}

	function pointer(type: string, clientX: number): PointerEvent {
		const event = new Event(type, { bubbles: true, cancelable: true });
		Object.assign(event, { pointerId: 1, pointerType: 'mouse', button: 0, clientX, clientY: 300 });
		return event as PointerEvent;
	}

	const press = (key: string): KeyboardEvent =>
		new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

	afterEach(() => prefs.set('readingWidth', null));

	it('is not there on a phone, where the note is the whole screen', async () => {
		await readCells(PHONE);

		expect(document.body.querySelector('[role="separator"]')).toBeNull();
	});

	// The nav pill, the bar over the chosen notes and the card beside a mark all
	// place themselves against this, so a drag that only spoke at the end would
	// leave the three of them behind the wall for as long as it lasted.
	it('tells the chrome beside it the new width while the drag is still happening', async () => {
		prefs.set('readingWidth', 500);
		await readCells(DESK);
		expect(dockInset()).toBe('500px');

		let told = 0;
		const heard = () => (told += 1);
		window.addEventListener('resize', heard);
		try {
			wall().dispatchEvent(pointer('pointerdown', 780));
			wall().dispatchEvent(pointer('pointermove', 740));
			await settle();

			expect(dockInset()).toBe('540px');
			expect(told).toBeGreaterThan(0);
		} finally {
			window.removeEventListener('resize', heard);
		}
	});

	it('keeps the width the drag settled on, for the next note this device opens', async () => {
		prefs.set('readingWidth', 500);
		await readCells(DESK);

		wall().dispatchEvent(pointer('pointerdown', 780));
		wall().dispatchEvent(pointer('pointermove', 740));
		wall().dispatchEvent(pointer('pointerup', 740));
		await settle();

		expect(prefs.current.readingWidth).toBe(540);
	});

	// The way back out of a long note is never a step away — DESIGN.md § Layout —
	// and a reader who has just opened a note is not looking for a resize handle.
	it('is not what a keyboard reader meets before the way out', async () => {
		await readCells(DESK);

		const reachable = [...surface().querySelectorAll<HTMLElement>('button, [tabindex="0"]')];
		expect(reachable[0]?.textContent?.trim()).toBe('Graph');
		expect(reachable).toContain(wall());
	});

	// A wall only a mouse can move is a desktop-only affordance.
	it('moves by the arrow keys, the way a separator does', async () => {
		prefs.set('readingWidth', 500);
		await readCells(DESK);

		wall().dispatchEvent(press('ArrowLeft'));
		await settle();
		expect(dockInset()).toBe('524px');

		wall().dispatchEvent(press('ArrowRight'));
		await settle();
		expect(dockInset()).toBe('500px');
	});

	// The graph is what the panel is docked against, and a note that could take
	// the whole window would leave nothing to be docked against.
	it('leaves the graph its own room however far the wall is pushed', async () => {
		prefs.set('readingWidth', 5000);
		await readCells(DESK);

		const took = Number(dockInset().replace('px', ''));
		expect(took).toBe(Number(wall().getAttribute('aria-valuemax')));
		expect(window.innerWidth - took).toBeGreaterThanOrEqual(448);
	});

	it('will not squeeze the note below the column it is written in', async () => {
		prefs.set('readingWidth', 10);
		await readCells(DESK);

		expect(dockInset()).toBe('352px');
	});

	// The reader drags the wall to get more room to write in, so the travel has
	// to buy them some: past the point the note's own column stops growing, the
	// graph would give up width and the words would gain none. One number bounds
	// both, and the surface hands it down so the two cannot drift apart.
	it('stops where the words stop widening, however much window there is', async () => {
		prefs.set('readingWidth', 5000);
		await readCells(2560);

		const column = Number(
			surface()
				.querySelector<HTMLElement>('[style*="--reading-column"]')
				?.style.getPropertyValue('--reading-column')
				.replace('px', '')
		);
		expect(column).toBe(672);
		// The panel's own gutters either side of that column, and nothing more.
		expect(Number(wall().getAttribute('aria-valuemax'))).toBe(column + 32);
		expect(dockInset()).toBe(`${column + 32}px`);
	});

	// A width nobody dragged to is not a width to keep, and one written down
	// would pin a panel that had been sizing itself to the window.
	it('keeps nothing from a press on the wall that never moved', async () => {
		await readCells(DESK);

		wall().dispatchEvent(pointer('pointerdown', 780));
		wall().dispatchEvent(pointer('pointerup', 780));
		await settle();

		expect(prefs.current.readingWidth).toBeNull();
	});
});

// A note deleted from inside the surface leaves the strip the way one deleted
// from the canvas does. The notes open beside it are not what was deleted.
describe('deleting the note being read', () => {
	it('takes it off the strip and leaves the others standing', async () => {
		await readCells(DESK);
		await alsoOpen('1');
		tab('1a').click();
		await settle();

		await act('Delete this note');
		exactly('Delete').click();
		await settle();

		expect(strip(), 'the deleted note is still on the strip').toBeNull();
		expect(titled()).toBe('Origins');
		expect(at.path).toBe(nodeHref(FIRST));
	});
});

describe('the graph beside a few open notes', () => {
	it('says which marks are open and which one is in front of the reader', async () => {
		await readCells(DESK);
		await alsoOpen('1b');
		tab('1a').click();
		await settle();
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
		expect(reading()).toBe(false);
		expect(lifted()).toEqual({});
	});

	// The refusal answers where the reader was standing when they asked, and a
	// step back is somewhere else. It rides the head of the surface, so one left
	// standing there sits over the note's own way out.
	it('takes down what it said about a full strip', async () => {
		await readCells(DESK);
		for (const address of ['1b', '1c', '1d', '1e', '1f']) {
			await alsoOpen(address);
			tab('1a').click();
			await settle();
		}
		await alsoOpen('1');
		expect(screen()).toContain('Close one to open another');

		back();
		await settle();
		expect(openTabs().reading).toBe('1f');
		expect(screen()).not.toContain('Close one to open another');

		while (strip() !== null) {
			back();
			await settle();
		}
		expect(screen()).not.toContain('Close one to open another');
	});
});
