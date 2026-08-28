import type { NodeView, OwnedRef } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { node, ref, useFakeApi, type FakeApi } from '../stores/fake-api.test-support.js';
import { nodes } from '../stores/nodes.svelte.js';
import { session } from '../stores/session.svelte.js';
import { tags } from '../stores/tags.svelte.js';
import { at } from './page.test-support.svelte.js';

vi.mock('$app/state', () => ({
	page: {
		get url() {
			return new URL(at.path, 'http://app.test');
		},
		get state() {
			return at.note ? { note: at.note } : {};
		}
	}
}));

vi.mock('$app/navigation', () => ({
	pushState: (path: string, state: { note?: OwnedRef }) => {
		if (path) at.path = path;
		at.note = state.note ?? null;
	},
	replaceState: (path: string, state: { note?: OwnedRef }) => {
		if (path) at.path = path;
		at.note = state.note ?? null;
	},
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
let graph: Map<OwnedRef, NodeView>;

function path(of: OwnedRef): string {
	const cut = of.lastIndexOf('/');
	return `/nodes/${encodeURIComponent(of.slice(0, cut))}/${encodeURIComponent(of.slice(cut + 1))}`;
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

function installGraph(): Map<OwnedRef, NodeView> {
	const held = new Map<OwnedRef, NodeView>([
		[FIRST, node(1, '1', { title: 'Origins' })],
		[SECOND, node(2, '1a', { title: 'Cells', origin: FIRST, parent: FIRST })],
		[THIRD, node(3, '2', { title: 'Method' })]
	]);
	api.on('GET /nodes/tags', () => []);
	api.on('GET /nodes', (url) => {
		const origin = url.searchParams.get('origin');
		return [...held.values()].filter((n) => (origin ? n.origin === origin : n.ref === n.origin));
	});
	for (const of of [FIRST, SECOND, THIRD]) {
		api.on(`GET ${path(of)}`, () => held.get(of) ?? null);
		api.on(`GET ${path(of)}/blocks`, () => []);
		api.on(`PATCH ${path(of)}`, (_url, init) => {
			const before = held.get(of);
			if (!before) return null;
			const after = { ...before, ...(JSON.parse(String(init?.body)) as Partial<NodeView>) };
			held.set(of, after);
			return after;
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

/** The control that opens what a drawn note stands for. */
function fold(address: string): HTMLButtonElement {
	const found = document.body.querySelector<HTMLButtonElement>(`[data-expand="${address}"]`);
	if (!found) throw new Error(`No note addressed ${address} is drawn`);
	return found;
}

/** Where the canvas has been told the reader is looking. */
const looking = () =>
	document.body.querySelector<HTMLElement>('[aria-label="The graph"]')?.dataset.focus;

function button(labelled: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].find((b) =>
		b.textContent?.includes(labelled)
	);
	if (!found) throw new Error(`No "${labelled}" button on screen`);
	return found;
}

const screen = () => document.body.textContent ?? '';

async function open(): Promise<void> {
	mounted = mount(Graph, { target });
	flushSync();
	await settle();
}

/** Open `1a` and ask for the note it links to to be picked on the graph. */
async function startLinking(): Promise<void> {
	await open();
	onCanvas('1a').click();
	await settle();
	button('Link to another note').click();
	await settle();
}

beforeEach(() => {
	at.path = '/';
	at.note = null;
	stubViewport();
	nodes.clear();
	tags.clear();
	api = useFakeApi();
	graph = installGraph();
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

describe('linking by pointing at the graph', () => {
	it('puts the graph forward, saying which note the choice is for', async () => {
		await startLinking();

		expect(screen()).toContain('Tap a note to link it to');
		expect(screen()).toContain('1a');
		// The note steps aside: on a phone the choice is the whole screen.
		expect(screen()).not.toContain('Link to another note');
	});

	it('marks the note being pointed from, so it is findable on the canvas', async () => {
		await startLinking();

		expect(onCanvas('1a').dataset.marked).toBe('from');
		expect(onCanvas('2').dataset.marked).toBeUndefined();
	});

	it('links the note that was tapped and comes back to the one being written', async () => {
		await startLinking();

		onCanvas('2').click();
		await settle();

		expect(graph.get(SECOND)?.links).toEqual([THIRD]);
		expect(screen()).toContain('Links to');
		expect(screen()).toContain('Method');
	});

	it('marks what it already links to, and never writes a second copy', async () => {
		graph.set(SECOND, { ...graph.get(SECOND)!, links: [THIRD] });
		await startLinking();
		expect(onCanvas('2').dataset.marked).toBe('taken');

		onCanvas('2').click();
		await settle();

		expect(graph.get(SECOND)?.links).toEqual([THIRD]);
		expect(screen()).toContain('Links to');
	});

	it('leaves the note untouched when the reader wants no link after all', async () => {
		await startLinking();

		button('Never mind').click();
		await settle();

		expect(graph.get(SECOND)?.links).toEqual([]);
		expect(screen()).toContain('Link to another note');
	});

	// Finding the note is half of pointing at it, so the level of detail has to
	// follow the reader into the fold they open rather than pulling them back.
	it('follows the reader into a fold opened to reach a note', async () => {
		await startLinking();
		expect(looking()).toBe(SECOND);

		fold('1').click();
		await settle();

		expect(looking()).toBe(FIRST);
	});

	// The canvas answers a pointer; the way out has to answer a keyboard too.
	it('leaves the choice on Escape', async () => {
		await startLinking();

		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		await settle();

		expect(graph.get(SECOND)?.links).toEqual([]);
		expect(screen()).toContain('Link to another note');
	});

	it('says so where the link would not save, and stays on the graph', async () => {
		await startLinking();
		api.on(
			`PATCH ${path(SECOND)}`,
			() => new Response('{"message":"Not right now."}', { status: 503 })
		);

		onCanvas('2').click();
		await settle();

		expect(screen()).toContain('Not right now.');
		expect(screen()).toContain('Tap a note to link it to');
	});
});
