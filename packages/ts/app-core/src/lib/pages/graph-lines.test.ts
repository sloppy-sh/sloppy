// DESIGN.md § Edges: a line is lit before it is edited.

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
		[FIRST, node(1, '1', { title: 'Origins', links: [THIRD] })],
		[SECOND, node(2, '1a', { title: 'Cells', origin: FIRST, parent: FIRST, links: [THIRD] })],
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

const canvas = () => document.body.querySelector('[aria-label="The graph"]');
async function open(): Promise<void> {
	session.adopt(VIEWER, 'a-session');
	mounted = mount(Graph, { target });
	flushSync();
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

const lit = () => Number(canvas()?.getAttribute('data-lit') ?? 0);
const sheet = (says: string) =>
	[...document.body.querySelectorAll('h2, [data-slot$="title"]')].some(
		(one) => one.textContent?.trim() === says
	);

async function tap(selector: string): Promise<void> {
	const found = document.body.querySelector<HTMLElement>(selector);
	if (!found) throw new Error(`Nothing on the canvas answers ${selector}`);
	found.click();
	await settle();
}

const line = `[data-line="1 ${THIRD}"]`;

async function key(name: string): Promise<void> {
	(document.activeElement ?? document.body).dispatchEvent(
		new KeyboardEvent('keydown', { key: name, bubbles: true })
	);
	await settle();
}

describe('a line on the canvas', () => {
	it('lights on the first tap and opens nothing', async () => {
		await open();
		await tap(line);
		expect(lit()).toBe(1);
		expect(sheet('This line')).toBe(false);
	});

	it('opens for its look on a second tap', async () => {
		await open();
		await tap(line);
		await tap(line);
		expect(sheet('This line')).toBe(true);
	});

	it('lets go on a tap on bare paper, and is lit again from the start', async () => {
		await open();
		await tap(line);
		await tap('[data-paper]');
		expect(lit()).toBe(0);
		await tap(line);
		expect(sheet('This line')).toBe(false);
	});

	it('lets go on a tap on a note', async () => {
		await open();
		await tap(line);
		const note = [
			...document.body.querySelectorAll<HTMLButtonElement>('[aria-label="The graph"] button')
		].find((one) => one.textContent?.includes('Method'));
		note?.click();
		await settle();
		expect(lit()).toBe(0);
	});

	it('lets go on Escape', async () => {
		await open();
		await tap(line);
		await key('Escape');
		expect(lit()).toBe(0);
	});

	it('opens on Enter while it is lit, and Enter alone opens nothing', async () => {
		await open();
		await key('Enter');
		expect(sheet('This line')).toBe(false);
		await tap(line);
		await key('Enter');
		expect(sheet('This line')).toBe(true);
	});

	it('lights the whole bundle it was tapped in, and says where the edited one stands', async () => {
		await open();
		await tap('[data-bundle]');
		expect(lit()).toBe(2);
		await tap(`[data-line="1a ${THIRD}"]`);
		expect(sheet('2 of 2 lines')).toBe(true);
	});

	it('lets go once its sheet is closed', async () => {
		await open();
		await tap(line);
		await tap(line);
		await key('Escape');
		expect(sheet('This line')).toBe(false);
		expect(lit()).toBe(0);
	});
});
