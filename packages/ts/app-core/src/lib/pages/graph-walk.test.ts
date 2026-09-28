import type { NodeView, OwnedRef } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { node, ref, useFakeApi, VIEWER, type FakeApi } from '../stores/fake-api.test-support.js';
import { nodes } from '../stores/nodes.svelte.js';
import { outlineSections } from '../stores/outline-sections.svelte.js';
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

const FIRST = ref(1);
const SECOND = ref(2);
const THIRD = ref(3);

let api: FakeApi;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

function path(of: OwnedRef): string {
	const cut = of.lastIndexOf('/');
	return `/nodes/${encodeURIComponent(of.slice(0, cut))}/${encodeURIComponent(of.slice(cut + 1))}`;
}

function installGraph(): void {
	const held = new Map<OwnedRef, NodeView>([
		[FIRST, node(1, '1', { title: 'Origins' })],
		[SECOND, node(2, '1a', { title: 'Cells', origin: FIRST, parent: FIRST })],
		[THIRD, node(3, '2', { title: 'Method' })]
	]);
	api.on('GET /nodes/tags', () => []);
	api.on('GET /publications', () => []);
	api.on('GET /nodes', (url) => {
		const origin = url.searchParams.get('origin');
		return [...held.values()].filter((one) =>
			origin ? one.origin === origin : one.ref === one.origin
		);
	});
	for (const of of [FIRST, SECOND, THIRD]) {
		api.on(`GET ${path(of)}`, () => held.get(of) ?? null);
		api.on(`GET ${path(of)}/blocks`, () => []);
	}
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

function labelled(label: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].find(
		(one) => one.getAttribute('aria-label') === label
	);
	if (!found) throw new Error(`Nothing on screen is labelled "${label}"`);
	return found;
}

const canvas = () => document.body.querySelector('[aria-label="The graph"]');
const rows = () => [...document.body.querySelectorAll<HTMLElement>('[role="treeitem"]')];
const addresses = () =>
	rows().map((row) => row.querySelector('.address')?.textContent?.trim() ?? '');

async function open(): Promise<void> {
	session.adopt(VIEWER, 'a-session');
	mounted = mount(Graph, { target });
	flushSync();
	await settle();
}

async function walk(): Promise<void> {
	await open();
	labelled('Outline').click();
	await settle();
}

/** One note through its own menu, which is the phone's way into choosing. */
async function choose(address: string): Promise<void> {
	const menu = document.body.querySelector<HTMLButtonElement>(`[data-menu="${address}"]`);
	menu?.click();
	await settle();
	const item = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
		(row) => row.textContent?.trim() === 'Choose this and others'
	);
	if (!item) throw new Error('The menu does not offer choosing');
	item.click();
	await settle();
}

beforeEach(() => {
	startAt('/');
	stubViewport();
	nodes.clear();
	outlineSections.clear();
	tags.clear();
	publications.clear();
	api = useFakeApi();
	installGraph();
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	// Where the reader is — walking rather than looking, and which branches they
	// opened — is kept across a mount, so a suite has to put it back itself.
	for (let turn = 0; turn < 20; turn += 1) {
		const open = document.body.querySelector<HTMLElement>('[aria-expanded="true"] button');
		if (!open) break;
		open.click();
		flushSync();
	}
	const back = [...document.body.querySelectorAll('button')].find(
		(one) => one.getAttribute('aria-label') === 'Graph'
	);
	back?.click();
	flushSync();
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	session.clear();
	target.remove();
	document.body.innerHTML = '';
});

describe('walking the notes instead of looking at them', () => {
	// The canvas is put away, not torn down: coming back to a pan and a zoom the
	// reader had already set is the difference between a view and a reload.
	it('is offered on the graph page, and puts the canvas away without losing it', async () => {
		await open();
		const field = canvas();
		expect(field).not.toBeNull();

		labelled('Outline').click();
		await settle();
		expect(addresses()).toEqual(['1', '2']);
		expect(canvas()).toBe(field);
		expect(field?.closest('.invisible')).not.toBeNull();

		labelled('Graph').click();
		await settle();
		expect(canvas()).toBe(field);
		expect(field?.closest('.invisible')).toBeNull();
	});

	it('is switched from the same place in either view', async () => {
		await open();
		const card = () => labelled('Outline').closest('[class*="rounded-2xl"]');
		const over = card();
		expect(over).not.toBeNull();
		expect(labelled('Graph').closest('[class*="rounded-2xl"]')).toBe(over);

		labelled('Outline').click();
		flushSync();
		expect(labelled('Graph').closest('[class*="rounded-2xl"]')).toBe(over);
		expect(labelled('Outline').getAttribute('aria-pressed')).toBe('true');
	});

	it('gives the canvas back', async () => {
		await walk();
		labelled('Graph').click();
		await settle();
		expect(canvas()).not.toBeNull();
		expect(rows()).toHaveLength(0);
	});

	it('takes the ground control away with the canvas it answers for', async () => {
		await open();
		expect(labelled('Background')).toBeTruthy();
		labelled('Outline').click();
		await settle();
		expect(
			[...document.body.querySelectorAll('button')].some(
				(one) => one.getAttribute('aria-label') === 'Background'
			)
		).toBe(false);
	});

	it('is not offered while a set is being chosen, which the tree cannot mark', async () => {
		await open();
		await choose('1');
		expect(document.body.textContent).toContain('1 note chosen');
		expect(() => labelled('Outline')).toThrow();
	});

	it('opens a note where it stands when the reader taps its row', async () => {
		await walk();
		rows()[0].click();
		await settle();
		expect(document.body.querySelector(`[data-interior="${FIRST}"]`)).not.toBeNull();
		expect(at.note).toBeNull();
	});

	it('takes the reader to a note’s own page from the row’s own act', async () => {
		await walk();
		labelled('Open the page of 1').click();
		await settle();
		expect(at.note).toBe(FIRST);
		expect(document.body.textContent).toContain('Origins');
	});

	it('keeps the branch the reader opened while they read a note in place', async () => {
		await walk();
		(rows()[0].querySelector('button') as HTMLButtonElement).click();
		await settle();
		expect(addresses()).toEqual(['1', '1a', '2']);
		rows()[1].click();
		await settle();
		expect(addresses().filter((one) => one !== '')).toEqual(['1', '1a', '2']);
	});
});
