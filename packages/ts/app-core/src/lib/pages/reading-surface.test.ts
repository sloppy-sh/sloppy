import type { NodeView, OwnedRef } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { node, ref, useFakeApi, type FakeApi } from '../stores/fake-api.test-support.js';
import { nodes } from '../stores/nodes.svelte.js';
import { session } from '../stores/session.svelte.js';
import { tags } from '../stores/tags.svelte.js';
import { at, back, pushed, replaced, startAt } from './page.test-support.svelte.js';
import { nodeHref } from './routes.js';

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
	pushState: (path: string, state: { note?: OwnedRef }) => pushed(path, state.note ?? null),
	replaceState: (path: string, state: { note?: OwnedRef }) => replaced(path, state.note ?? null),
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
		[SECOND, node(2, '1a', { title: 'Cells', origin: FIRST, parent: FIRST })]
	]);
	api.on('GET /nodes/tags', () => []);
	api.on('GET /nodes', (url) => {
		const origin = url.searchParams.get('origin');
		return [...held.values()].filter((n) => (origin ? n.origin === origin : n.ref === n.origin));
	});
	for (const of of [FIRST, SECOND]) {
		api.on(`GET ${path(of)}`, () => held.get(of) ?? null);
		api.on(`GET ${path(of)}/blocks`, () => []);
		api.on(`PATCH ${path(of)}`, () => held.get(of) ?? null);
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

/** What the tag field invites, which says whether it is on screen at all. */
function tagInvite(): string {
	const field = surface().querySelector<HTMLInputElement>('input[role="combobox"]');
	if (!field) throw new Error('The note has no tag field');
	return field.placeholder;
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
