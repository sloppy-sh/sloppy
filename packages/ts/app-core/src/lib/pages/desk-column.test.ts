// The column beside the graph: one History, standing open where the versions
// can be reached, and a field that goes to a note without taking the page
// away — DESIGN.md § Layout.

import { HistoryError, LocalApi, MemoryFiles, MemoryHistory } from '@sloppy/local';
import type { OwnedRef, Viewer } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetApi } from '../api.js';
import { initRuntime } from '../runtime.js';
import { conversation } from '../stores/conversation.svelte.js';
import { find } from '../stores/find.svelte.js';
import { graphs } from '../stores/graphs.svelte.js';
import { graphHistory } from '../stores/history.svelte.js';
import { identity } from '../stores/identity.svelte.js';
import { nodes } from '../stores/nodes.svelte.js';
import { outlineSections } from '../stores/outline-sections.svelte.js';
import { peers } from '../stores/peers.svelte.js';
import { people } from '../stores/people.svelte.js';
import { prefs } from '../stores/prefs.svelte.js';
import { publications } from '../stores/publications.svelte.js';
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

const Chrome = (await import('./graph-in-chrome.test-support.svelte')).default;

const ROOT = '/Users/me/garden';

let store: Map<string, Uint8Array>;
let served: LocalApi;
let kept: MemoryHistory;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
/** What this folder's own history would say about standing on a version, where
 *  it would not. */
let standingRefused: string | null;

function folder(): MemoryFiles {
	return new MemoryFiles({ root: ROOT, store, data: '/data' });
}

function theHistory(): MemoryHistory {
	const says = standingRefused;
	if (says === null) return kept;
	return new Proxy(kept, {
		get: (on, name) =>
			name === 'standOn' ? () => Promise.reject(new HistoryError(says)) : Reflect.get(on, name, on)
	});
}

/** Wide enough that the chrome stands beside the graph rather than over it. */
function stubDesk(): void {
	Element.prototype.hasPointerCapture = () => false;
	Element.prototype.setPointerCapture = () => {};
	Element.prototype.releasePointerCapture = () => {};
	Element.prototype.scrollIntoView = () => {};
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: (query: string) => ({
			matches: query.includes('min-width'),
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
	for (let frame = 0; frame < 3; frame += 1) await new Promise(requestAnimationFrame);
	flushSync();
}

const column = () => document.body.querySelector<HTMLElement>('aside[aria-label="Sloppy"]');

function inColumn(): HTMLElement {
	const held = column();
	if (!held) throw new Error('No column stands beside the graph');
	return held;
}

function rows(): string[] {
	return [...inColumn().querySelectorAll('button')].map((one) =>
		(one.textContent ?? '').replace(/\s+/g, ' ').trim()
	);
}

function control(labelled: string): HTMLButtonElement {
	const found = [...inColumn().querySelectorAll('button')].find(
		(one) => (one.textContent ?? '').replace(/\s+/g, ' ').trim() === labelled
	);
	if (!found) throw new Error(`Nothing in the column is labelled "${labelled}"`);
	return found;
}

function field(): HTMLInputElement {
	const found = inColumn().querySelector<HTMLInputElement>('[aria-label^="Find a note"]');
	if (!found) throw new Error('The column carries no field to find a note with');
	return found;
}

/** Everything the canvas is drawing, as the stub spells it. */
function drawn(): string {
	const canvas = document.body.querySelector('[aria-label="The graph"]');
	return (canvas?.textContent ?? '').replace(/\s+/g, ' ');
}

/** A control anywhere, including the surfaces a question opens over the page. */
function anywhere(labelled: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].find(
		(one) => (one.textContent ?? '').replace(/\s+/g, ' ').trim() === labelled
	);
	if (!found) throw new Error(`Nothing on the screen is labelled "${labelled}"`);
	return found;
}

const screen = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

async function type(words: string): Promise<void> {
	field().value = words;
	field().dispatchEvent(new Event('input', { bubbles: true }));
	await settle();
}

beforeEach(async () => {
	startAt('/');
	stubDesk();
	localStorage.clear();
	prefs.init();
	nodes.clear();
	outlineSections.clear();
	peers.clear();
	tags.clear();
	publications.clear();
	conversation.clear();
	identity.clear();
	find.clear();
	graphs.clear();
	people.hold(null);
	graphHistory.clear();
	store = new Map();
	standingRefused = null;
	served = new LocalApi(folder());
	kept = new MemoryHistory(folder(), { author: 'Ada' });
	initRuntime({
		apiHost: () => '',
		mode: () => 'local',
		createApi: () => (served = new LocalApi(folder())),
		vault: {
			folder: () => ROOT,
			graph: () => new LocalApi(folder()).graphHere(),
			asks: true,
			open: async () => ROOT
		},
		history: () => theHistory()
	});
	resetApi();
	target = document.createElement('div');
	document.body.appendChild(target);
	await served.createNode({ title: 'Origins' });
	const viewer = (await served.me()) as Viewer;
	session.adopt(viewer, 'this device');
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	session.clear();
	graphHistory.clear();
	initRuntime({ apiHost: () => '', mode: () => 'hosted', history: () => undefined });
	resetApi();
	target.remove();
	document.body.innerHTML = '';
});

describe('the history beside the graph', () => {
	async function standing(): Promise<void> {
		mounted = mount(Chrome, { target });
		await settle();
	}

	/** The section holds what a narrow column cannot show at once, so it folds;
	 *  this is somebody opening it. */
	async function openHistory(): Promise<void> {
		control('History').click();
		await settle();
	}

	// One History in the column: the section that holds the versions. A row
	// beside it opening a surface over the page is the same word twice.
	it('stands as one section and not also as a row', async () => {
		await graphHistory.keep('A first version');
		await standing();

		expect(rows().filter((said) => said === 'History')).toHaveLength(1);
		expect(control('History').getAttribute('aria-expanded')).toBe('false');
	});

	// The picture is what the section is for, so nothing beyond opening it has
	// to be asked for before a version can be seen.
	it('draws the versions as soon as it is opened', async () => {
		await graphHistory.keep('A first version');
		await standing();
		await openHistory();

		expect(inColumn().querySelector('[aria-label="The history"]')).not.toBeNull();
		expect(inColumn().textContent).toContain('A first version');
	});

	// Switching line is how somebody reaches an older state quickly; a surface
	// that only listed versions could not do it.
	it('names the lines this folder keeps and moves onto the one tapped', async () => {
		await graphHistory.keep('A first version');
		await kept.branch('an-older-thought');
		await standing();
		await openHistory();

		const lines = inColumn().querySelector('[aria-label="The lines this folder keeps"]');
		expect(lines?.textContent).toContain('an-older-thought');
		expect(
			[...(lines?.querySelectorAll('button') ?? [])]
				.find((one) => one.textContent?.trim() === 'main')
				?.getAttribute('aria-pressed')
		).toBe('true');

		control('an-older-thought').click();
		await settle();

		expect(graphHistory.line).toBe('an-older-thought');
	});

	// The documents come first and the code grows out of them (AI.md § Project),
	// so a version is somewhere to write from rather than somewhere to look.
	it('offers to work on a version when one is tapped', async () => {
		await graphHistory.keep('A first version');
		await standing();
		await openHistory();

		const version = inColumn().querySelector<HTMLButtonElement>(
			'[aria-label="The history"] li button'
		);
		expect(version).not.toBeNull();
		version?.click();
		await settle();

		expect(rows()).toContain('Work on this version');
		expect(rows()).toContain('Read the graph as it was here');
		expect(rows()).toContain('Everything about this version');
	});

	// Reading a version is still reading — DESIGN.md § "The history as a
	// picture" — so the act that moves nothing stands beside the one that does.
	it('puts a version on the canvas as it was, without moving the folder', async () => {
		await graphHistory.keep('A first version');
		await served.createNode({ title: 'A second thought' });
		await graphHistory.keep('A second version');
		await standing();
		await openHistory();
		const found = [
			...inColumn().querySelectorAll<HTMLButtonElement>('[aria-label="The history"] li button')
		].find((one) => (one.textContent ?? '').includes('A first version'));
		found?.click();
		await settle();

		control('Read the graph as it was here').click();
		await settle();

		expect(screen()).toContain('Your graph as it was');
		expect(drawn()).not.toContain('A second thought');
		expect(graphHistory.line).toBe('main');
	});

	// A refusal is the answer somebody gets, rather than a control that looks
	// like it did nothing.
	it('says what the folder would not do when nothing is unkept', async () => {
		await graphHistory.keep('A first version');
		await served.createNode({ title: 'A second thought' });
		await graphHistory.keep('A second version');
		standingRefused = 'Finish what you started here first, then try again.';
		await standing();
		await openHistory();
		const found = [
			...inColumn().querySelectorAll<HTMLButtonElement>('[aria-label="The history"] li button')
		].find((one) => (one.textContent ?? '').includes('A first version'));
		found?.click();
		await settle();

		control('Work on this version').click();
		await settle();

		expect(screen()).toContain('Finish what you started here first, then try again.');
		expect(graphHistory.line).toBe('main');
	});
});

describe('standing on a version', () => {
	async function standing(): Promise<void> {
		mounted = mount(Chrome, { target });
		await settle();
	}

	/** Two versions, the older one holding only what the folder started with. */
	async function twoVersions(): Promise<void> {
		await graphHistory.keep('A first version');
		await served.createNode({ title: 'A second thought' });
		await graphHistory.keep('A second version');
	}

	async function openHistory(): Promise<void> {
		control('History').click();
		await settle();
	}

	/** Somebody tapping the row a version is drawn on, which offers its acts. */
	async function tap(message: string): Promise<void> {
		const found = [
			...inColumn().querySelectorAll<HTMLButtonElement>('[aria-label="The history"] li button')
		].find((one) => (one.textContent ?? '').includes(message));
		if (!found) throw new Error(`No version in the picture says "${message}"`);
		found.click();
		await settle();
	}

	// The whole point: the folder becomes that version, so what is read there is
	// read off the disk rather than out of a snapshot held on the canvas.
	it('makes the folder that version, on no line', async () => {
		await twoVersions();
		await standing();
		await openHistory();
		const now = graphHistory.at;

		await tap('A first version');
		control('Work on this version').click();
		await settle();

		expect(graphHistory.at).not.toBe(now);
		expect(graphHistory.line).toBeUndefined();
		expect(drawn()).toContain('Origins');
		expect(drawn()).not.toContain('A second thought');
		expect(screen()).toContain('Working on a version,');
	});

	// Nothing is greyed out and there is no mode to leave — DESIGN.md § "The
	// history as a picture".
	it('leaves every control live', async () => {
		await twoVersions();
		await standing();
		await openHistory();
		await tap('A first version');
		control('Work on this version').click();
		await settle();

		expect(document.body.querySelectorAll('[data-menu]').length).toBeGreaterThan(0);
		expect(field()).not.toBeNull();
		expect(inColumn().querySelector('[aria-label="Your graphs"]')).not.toBeNull();
		expect(rows()).toContain('New branch');
		expect(screen()).not.toContain('Your graph as it was');
	});

	// The line opens on the first write, not at the checkout: standing on a
	// version to read it leaves nothing behind.
	it('opens a line on the first thing written, and offers to rename it', async () => {
		await twoVersions();
		await standing();
		await openHistory();
		await tap('A first version');
		control('Work on this version').click();
		await settle();
		const stood = graphHistory.at;
		expect(graphHistory.line).toBeUndefined();

		window.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true })
		);
		await settle();

		expect(graphHistory.line).toBe(`from-${stood?.slice(0, 8)}`);
		// No file moved to open it: the line begins at the version stood on.
		expect(graphHistory.at).toBe(stood);
		expect(document.body.querySelectorAll('[data-expand]')).toHaveLength(2);
		expect(screen()).toContain(`Your writing opened a new line, from-${stood?.slice(0, 8)}.`);
		expect(rows()).toContain('Rename');
	});

	it('renames that line when somebody asks', async () => {
		await twoVersions();
		await standing();
		await openHistory();
		await tap('A first version');
		control('Work on this version').click();
		await settle();
		window.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true })
		);
		await settle();

		control('Rename').click();
		await settle();
		const named = inColumn().querySelector<HTMLInputElement>(
			'[aria-label="What this line is called"]'
		);
		if (!named) throw new Error('Nothing in the column names the line');
		named.value = 'the-other-way';
		named.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		control('Rename it').click();
		await settle();

		expect(graphHistory.line).toBe('the-other-way');
	});
});

describe('writing nobody has kept, on the way to somewhere else', () => {
	async function standing(): Promise<void> {
		mounted = mount(Chrome, { target });
		await settle();
	}

	async function openHistory(): Promise<void> {
		control('History').click();
		await settle();
	}

	async function tapTheFirst(): Promise<void> {
		await graphHistory.keep('A first version');
		await served.createNode({ title: 'A second thought' });
		await graphHistory.keep('A second version');
		await served.createNode({ title: 'Something unkept' });
		await standing();
		await openHistory();
		const found = [
			...inColumn().querySelectorAll<HTMLButtonElement>('[aria-label="The history"] li button')
		].find((one) => (one.textContent ?? '').includes('A first version'));
		found?.click();
		await settle();
		control('Work on this version').click();
		await settle();
	}

	// A person's own writing is never guessed at — DESIGN.md § "The history as a
	// picture".
	it('asks, rather than moving the folder', async () => {
		await tapTheFirst();
		const now = graphHistory.at;

		expect(screen()).toContain('You have writing nobody has kept');
		expect(anywhere('Keep a version first')).not.toBeNull();
		expect(anywhere('Bring them with me')).not.toBeNull();
		expect(anywhere('Stay here')).not.toBeNull();
		expect(graphHistory.at).toBe(now);
	});

	it('does nothing at all when the answer is to stay', async () => {
		await tapTheFirst();
		const now = graphHistory.at;

		anywhere('Stay here').click();
		await settle();

		expect(graphHistory.at).toBe(now);
		expect(graphHistory.line).toBe('main');
		expect(drawn()).toContain('Something unkept');
	});

	it('keeps a version on the line being left, then goes', async () => {
		await tapTheFirst();
		const wasAt = graphHistory.lines.find((one) => one.name === 'main')?.head;

		anywhere('Keep a version first').click();
		await settle();

		expect(graphHistory.line).toBeUndefined();
		expect(drawn()).not.toContain('Something unkept');
		expect(graphHistory.lines.find((one) => one.name === 'main')?.head).not.toBe(wasAt);
	});

	it('brings the writing along when asked to', async () => {
		await tapTheFirst();

		anywhere('Bring them with me').click();
		await settle();

		expect(graphHistory.line).toBeUndefined();
		expect(drawn()).toContain('Origins');
		expect(drawn()).toContain('Something unkept');
		expect(drawn()).not.toContain('A second thought');
	});

	// A refusal in a person's own writing is the answer they get, rather than a
	// silence they have to work out.
	it('says what the folder would not do when the writing cannot travel', async () => {
		await graphHistory.keep('A first version');
		const second = await served.createNode({ title: 'A second thought' });
		await graphHistory.keep('A second version');
		await served.updateNode(second.ref, { title: 'A second thought, rewritten' });
		await standing();
		await openHistory();
		const found = [
			...inColumn().querySelectorAll<HTMLButtonElement>('[aria-label="The history"] li button')
		].find((one) => (one.textContent ?? '').includes('A first version'));
		found?.click();
		await settle();
		control('Work on this version').click();
		await settle();

		anywhere('Bring them with me').click();
		await settle();

		expect(screen()).toContain('would be written over');
		expect(graphHistory.line).toBe('main');
		expect(drawn()).toContain('A second thought, rewritten');
	});

	// A folder is written into while the column stands beside it, so what is
	// unkept is asked of the folder as somebody moves rather than remembered
	// from when the picture was drawn.
	it('asks though the writing came after the picture was drawn', async () => {
		await graphHistory.keep('A first version');
		await served.createNode({ title: 'A second thought' });
		await graphHistory.keep('A second version');
		await standing();
		await openHistory();
		await served.createNode({ title: 'Something unkept' });
		const found = [
			...inColumn().querySelectorAll<HTMLButtonElement>('[aria-label="The history"] li button')
		].find((one) => (one.textContent ?? '').includes('A first version'));
		found?.click();
		await settle();

		control('Work on this version').click();
		await settle();

		expect(screen()).toContain('You have writing nobody has kept');
		expect(anywhere('Bring them with me')).not.toBeNull();
		expect(graphHistory.line).toBe('main');
	});

	// The chips move the folder too, so they ask the same question.
	it('asks before a line is tapped as well', async () => {
		await graphHistory.keep('A first version');
		await kept.branch('an-older-thought');
		await served.createNode({ title: 'Something unkept' });
		await standing();
		await openHistory();

		control('an-older-thought').click();
		await settle();

		expect(screen()).toContain('You have writing nobody has kept');
		expect(graphHistory.line).toBe('main');
	});
});

describe('finding a note beside the graph', () => {
	async function standing(): Promise<void> {
		mounted = mount(Chrome, { target });
		await settle();
	}

	// A column has the room, so looking for a note does not take the graph away.
	it('opens no surface over the page, and offers nothing until something is typed', async () => {
		await standing();

		expect(field()).not.toBeNull();
		expect(document.body.querySelector('[role="dialog"]')).toBeNull();
		expect(inColumn().querySelectorAll('[role="option"]')).toHaveLength(0);
	});

	it('keeps the page where it is and the words where they were once a note is taken', async () => {
		await standing();
		await type('Origins');

		const row = inColumn().querySelector<HTMLButtonElement>('[role="option"] button');
		expect(row?.textContent).toContain('Origins');

		row?.click();
		await settle();

		expect(document.body.querySelector('[role="dialog"]')).toBeNull();
		expect(field().value).toBe('Origins');
	});
});
