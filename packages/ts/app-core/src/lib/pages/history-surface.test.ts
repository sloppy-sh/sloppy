// The graph as it was, on the canvas: a version kept, opened from the history,
// drawn in place of the graph and taking nothing.

import { LocalApi, MemoryFiles, MemoryHistory } from '@sloppy/local';
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

const Graph = (await import('./graph.svelte')).default;

const ROOT = '/Users/me/garden';

let store: Map<string, Uint8Array>;
let served: LocalApi;
let kept: MemoryHistory;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

function folder(): MemoryFiles {
	return new MemoryFiles({ root: ROOT, store, data: '/data' });
}

function stubBrowser(): void {
	// jsdom drives no pointer, and a picker asks the element it is on about one.
	Element.prototype.hasPointerCapture = () => false;
	Element.prototype.setPointerCapture = () => {};
	Element.prototype.releasePointerCapture = () => {};
	Element.prototype.scrollIntoView = () => {};
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: (query: string) => ({
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
	for (let frame = 0; frame < 3; frame += 1) await new Promise(requestAnimationFrame);
	flushSync();
}

const screen = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

function control(labelled: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].find((one) =>
		one.textContent?.includes(labelled)
	);
	if (!found) throw new Error(`Nothing on the screen is labelled "${labelled}"`);
	return found;
}

function drawn(): string[] {
	return [...document.body.querySelectorAll('[aria-label="The graph"] li button')]
		.map((one) => one.textContent?.trim() ?? '')
		.filter(
			(said) => said !== '' && !said.startsWith('open what is under') && !said.startsWith('menu on')
		);
}

/** The rows teaching what the canvas is drawing, beside the tag rail. */
function legend(): string[] {
	return [...document.body.querySelectorAll('[aria-label="What the graph is drawing"] li')].map(
		(one) => (one.textContent ?? '').replace(/\s+/g, ' ').trim()
	);
}

async function openMore(): Promise<void> {
	const more = [...document.body.querySelectorAll('button')].find(
		(one) => one.getAttribute('aria-label') === 'More'
	);
	if (!more) throw new Error('The graph carries no More control');
	more.click();
	await settle();
}

async function pick(labelled: string, state: string): Promise<void> {
	const trigger = document.body.querySelector<HTMLElement>(
		`[aria-labelledby="difference-${labelled.toLowerCase()}"]`
	);
	if (!trigger) throw new Error(`No picker is labelled "${labelled}"`);
	trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
	trigger.click();
	await settle();
	const option = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find(
		(one) => one.textContent?.trim() === state
	);
	if (!option) throw new Error(`The picker does not offer "${state}"`);
	option.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
	option.click();
	await settle();
}

/** What stands under a heading on the surface. */
function said(heading: string): string {
	const found = [...document.body.querySelectorAll('h3')].find(
		(one) => one.textContent?.trim() === heading
	);
	if (!found) throw new Error(`Nothing on the screen is headed "${heading}"`);
	return (found.parentElement?.textContent ?? '').replace(/\s+/g, ' ');
}

function menu(on: string): HTMLButtonElement {
	const found = document.body.querySelector<HTMLButtonElement>(`[data-menu="${on}"]`);
	if (!found) throw new Error(`Nothing on the graph carries a menu on ${on}`);
	return found;
}

function item(label: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
		(row) => row.textContent?.trim() === label
	);
	if (!found) throw new Error(`The menu does not offer "${label}"`);
	return found;
}

beforeEach(async () => {
	startAt('/');
	stubBrowser();
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
		history: () => kept
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

describe('two states of the graph, set against each other', () => {
	it('draws what changed on the canvas, and acts on nothing while it is up', async () => {
		await graphHistory.keep('A first version');
		const second = await served.createNode({ title: 'A second thought' });
		mounted = mount(Graph, { target });
		await settle();
		await openMore();
		item('History').click();
		await settle();

		await pick('From', 'A first version');
		control('Show what changed').click();
		await settle();

		expect(screen()).toContain('What changed');
		expect(screen()).toContain('A first version to Now');
		const marks = [...document.body.querySelectorAll('[aria-label="The graph"] [data-difference]')];
		expect(
			marks.map((one) => [
				(one.textContent ?? '').replace(/\s+/g, ' ').trim(),
				one.getAttribute('data-difference')
			])
		).toEqual([[`${second.address} A second thought`, 'arrived']]);

		menu('the canvas').click();
		await settle();

		expect(document.body.querySelectorAll('[role="menuitem"]')).toHaveLength(0);
	});

	it('teaches the four things the marks and the lines mean, and stops when the comparison does', async () => {
		await graphHistory.keep('A first version');
		await served.createNode({ title: 'A second thought' });
		mounted = mount(Graph, { target });
		await settle();
		await openMore();
		item('History').click();
		await settle();
		await pick('From', 'A first version');
		control('Show what changed').click();
		await settle();

		expect(legend()).toEqual([
			'A new note',
			'A note that went, where it stood',
			'A note that is not as it was',
			'A note that moved: the line it joined, over the one it left'
		]);

		control('Your graph now').click();
		await settle();

		expect(legend()).toEqual([]);
		expect(document.body.querySelectorAll('[data-difference]')).toHaveLength(0);
		expect(drawn().join(' ')).toContain('A second thought');
	});

	it('draws nothing on the canvas where the two states are the same', async () => {
		await graphHistory.keep('A first version');
		mounted = mount(Graph, { target });
		await settle();
		await openMore();
		item('History').click();
		await settle();
		await pick('From', 'A first version');
		control('Show what changed').click();
		await settle();

		expect(screen()).toContain('These two are the same.');

		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await settle();

		expect(legend()).toEqual([]);
		expect(document.body.querySelectorAll('[data-difference]')).toHaveLength(0);
		expect(screen()).not.toContain('What changed');
		expect(drawn().join(' ')).toContain('Origins');
	});

	it('puts the words back beside the marks once the surface has been put away', async () => {
		await graphHistory.keep('A first version');
		await served.createNode({ title: 'A second thought' });
		mounted = mount(Graph, { target });
		await settle();
		await openMore();
		item('History').click();
		await settle();
		await pick('From', 'A first version');
		control('Show what changed').click();
		await settle();

		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await settle();
		expect(screen()).not.toContain('Since your last version');

		control('In words').click();
		await settle();

		expect(screen()).toContain('Since your last version');
		expect(screen()).toContain('A first version to Now');
		expect(said('What is different')).toContain('New note');
	});
});

describe('a version of the graph, opened from the history', () => {
	it('draws the graph as it was, and takes nothing while it is up', async () => {
		await graphHistory.keep('A first version');
		await served.createNode({ title: 'A second thought' });
		mounted = mount(Graph, { target });
		await settle();
		expect(drawn().join(' ')).toContain('A second thought');

		await openMore();
		item('History').click();
		await settle();
		control('A first version').click();
		await settle();
		control('Read your graph as it was').click();
		await settle();

		expect(screen()).toContain('Your graph as it was');
		expect(screen()).toContain('A first version');
		expect(drawn().join(' ')).toContain('Origins');
		expect(drawn().join(' ')).not.toContain('A second thought');
		expect(
			document.body.querySelector('[aria-label="The graph"]')?.getAttribute('data-inking')
		).toBe(null);
		expect(
			[...document.body.querySelectorAll('button')].some((one) =>
				one.textContent?.includes('New branch')
			)
		).toBe(false);
	});

	it('writes nothing into the graph when the keyboard asks for a note', async () => {
		await graphHistory.keep('A first version');
		await served.createNode({ title: 'A second thought' });
		mounted = mount(Graph, { target });
		await settle();
		await openMore();
		item('History').click();
		await settle();
		control('A first version').click();
		await settle();
		control('Read your graph as it was').click();
		await settle();

		window.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true })
		);
		await settle();

		const fresh = new LocalApi(folder());
		const still = await fresh.listNodes({ graph: await fresh.graphHere() });
		expect(still.map((one) => one.title)).toEqual(['Origins', 'A second thought']);
		expect(screen()).toContain('Your graph as it was');
		expect(drawn().join(' ')).not.toContain('Untitled');
	});

	it('opens the history again without leaving the version', async () => {
		await graphHistory.keep('A first version');
		await served.createNode({ title: 'A second thought' });
		mounted = mount(Graph, { target });
		await settle();
		await openMore();
		item('History').click();
		await settle();
		control('A first version').click();
		await settle();
		control('Read your graph as it was').click();
		await settle();
		expect(screen()).not.toContain('Since your last version');

		control('History').click();
		await settle();

		expect(screen()).toContain('Since your last version');
		expect(screen()).toContain('Your graph as it was');
		expect(drawn().join(' ')).not.toContain('A second thought');
	});

	it('goes back to the graph as it is', async () => {
		await graphHistory.keep('A first version');
		await served.createNode({ title: 'A second thought' });
		mounted = mount(Graph, { target });
		await settle();
		await openMore();
		item('History').click();
		await settle();
		control('A first version').click();
		await settle();
		control('Read your graph as it was').click();
		await settle();

		control('Your graph now').click();
		await settle();

		expect(screen()).not.toContain('Your graph as it was');
		expect(drawn().join(' ')).toContain('A second thought');
	});
});
