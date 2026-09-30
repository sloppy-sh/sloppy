// The column beside the graph: one History, standing open where the versions
// can be reached, and a field that goes to a note without taking the page
// away — DESIGN.md § Layout.

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

const Chrome = (await import('./graph-in-chrome.test-support.svelte')).default;

const ROOT = '/Users/me/garden';

let store: Map<string, Uint8Array>;
let served: LocalApi;
let kept: MemoryHistory;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

function folder(): MemoryFiles {
	return new MemoryFiles({ root: ROOT, store, data: '/data' });
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

	it('offers to put a version on the canvas when one is tapped', async () => {
		await graphHistory.keep('A first version');
		await standing();
		await openHistory();

		const version = inColumn().querySelector<HTMLButtonElement>(
			'[aria-label="The history"] li button'
		);
		expect(version).not.toBeNull();
		version?.click();
		await settle();

		expect(rows()).toContain('Read the graph as it was here');
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
