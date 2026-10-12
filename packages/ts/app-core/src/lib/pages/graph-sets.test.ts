// Seeing the notes as sets: the third reading of the same canvas, the sets a
// note can be moved into and out of from the surfaces that already act on
// notes, and what the chrome says where the question is not yet a diagram —
// DESIGN.md § "Sets — the tags as places".

import type { NodeBulkRequest, NodeView, OwnedRef, Tag, UpdateNodeRequest } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { node, ref, useFakeApi, VIEWER, type FakeApi } from '../stores/fake-api.test-support.js';
import { acts } from '../stores/acts.svelte.js';
import { nodes } from '../stores/nodes.svelte.js';
import { outlineSections } from '../stores/outline-sections.svelte.js';
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
const Chrome = (await import('./graph-in-chrome.test-support.svelte')).default;

const FIRST = ref(1);
const SECOND = ref(2);
const THIRD = ref(3);

/** Most-carried first, ties by name — the order the rail is a legend in, and
 *  the order "the three most used" reads off. */
const COUNTED = [
	{ tag: 'biology', notes: 5 },
	{ tag: 'method', notes: 3 },
	{ tag: 'seed', notes: 3 },
	{ tag: 'soil', notes: 3 }
];

let api: FakeApi;
let held: Map<OwnedRef, NodeView>;
let written: UpdateNodeRequest[];
let bulk: NodeBulkRequest[];
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
/** Whether the chrome stands beside the graph rather than over it. */
let wide = false;

function path(of: OwnedRef): string {
	const cut = of.lastIndexOf('/');
	return `/nodes/${encodeURIComponent(of.slice(0, cut))}/${encodeURIComponent(of.slice(cut + 1))}`;
}

function installGraph(): void {
	held = new Map<OwnedRef, NodeView>([
		[FIRST, node(1, '1', { title: 'Origins', tags: ['biology' as Tag] })],
		[
			SECOND,
			node(2, '1a', {
				title: 'Cells',
				origin: FIRST,
				parent: FIRST,
				tags: ['seed' as Tag, 'method' as Tag]
			})
		],
		[THIRD, node(3, '2', { title: 'Method' })]
	]);
	api.on('GET /nodes/tags', () => COUNTED);
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
		api.on(`PATCH ${path(of)}`, (_url, init) => {
			const asked = JSON.parse(String(init?.body ?? '{}')) as UpdateNodeRequest;
			written.push(asked);
			const after = { ...held.get(of)!, ...asked } as NodeView;
			held.set(of, after);
			return after;
		});
	}
	api.on('POST /nodes/bulk', (_url, init) => {
		const asked = JSON.parse(String(init?.body ?? '{}')) as NodeBulkRequest;
		bulk.push(asked);
		const reached = asked.notes.map((of) => held.get(of)).filter((one) => one !== undefined);
		return { reached: reached.length, missed: 0, notes: reached };
	});
}

function stubViewport(): void {
	Element.prototype.hasPointerCapture = () => false;
	Element.prototype.setPointerCapture = () => {};
	Element.prototype.releasePointerCapture = () => {};
	Element.prototype.scrollIntoView = () => {};
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: (query: string) => ({
			matches: wide ? query.includes('min-width') : query.includes('max-width'),
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

function labelled(label: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].find(
		(one) => one.getAttribute('aria-label') === label
	);
	if (!found) throw new Error(`Nothing on screen is labelled "${label}"`);
	return found;
}

const canvas = () => document.body.querySelector<HTMLElement>('[aria-label="The graph"]');

function field(): HTMLElement {
	const found = canvas();
	if (!found) throw new Error('There is no canvas on the page');
	return found;
}

const screen = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

function says(words: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].find(
		(one) => (one.textContent ?? '').replace(/\s+/g, ' ').trim() === words
	);
	if (!found) throw new Error(`Nothing on screen says "${words}"`);
	return found;
}

const menuRows = () =>
	[...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((row) =>
		(row.textContent ?? '').replace(/\s+/g, ' ').trim()
	);

async function openMenu(on: string): Promise<void> {
	document.body.querySelector<HTMLButtonElement>(`[data-menu="${on}"]`)?.click();
	await settle();
}

async function rest(on: string): Promise<void> {
	document.body.querySelector<HTMLButtonElement>(`[data-rest="${on}"]`)?.click();
	await settle();
}

/** The card a mark draws under a pointer at rest: hidden from a screen reader,
 *  and the only such thing on the page that writes an address. */
const preview = () =>
	[...document.body.querySelectorAll<HTMLElement>('[aria-hidden="true"]')].find((one) =>
		one.querySelector('.address')
	);

async function runRow(words: string): Promise<void> {
	const row = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
		(one) => (one.textContent ?? '').replace(/\s+/g, ' ').trim() === words
	);
	if (!row) throw new Error(`The menu does not offer "${words}"`);
	row.click();
	await settle();
}

async function open(): Promise<void> {
	session.adopt(VIEWER, 'a-session');
	mounted = mount(Graph, { target });
	flushSync();
	await settle();
}

/** The page inside the chrome, where the column stands beside the graph. */
async function openOnTheDesk(): Promise<void> {
	wide = true;
	stubViewport();
	session.adopt(VIEWER, 'a-session');
	mounted = mount(Chrome, { target });
	flushSync();
	await settle();
}

/** On the canvas, with the sets drawn and `drawn` the tags they are drawn from. */
async function inSets(drawn: string[] = []): Promise<void> {
	await open();
	labelled('Sets').click();
	await settle();
	if (drawn.length > 0) {
		tags.select(drawn as Tag[]);
		await settle();
	}
}

/** Notes through their own menus, which is the phone's way into choosing: the
 *  first one puts the canvas in the mode and the rest join the set. */
async function choose(...addresses: string[]): Promise<void> {
	for (const [place, address] of addresses.entries()) {
		await openMenu(address);
		await runRow(place === 0 ? 'Choose this and others' : 'Choose this one too');
	}
}

beforeEach(() => {
	startAt('/');
	wide = false;
	stubViewport();
	localStorage.clear();
	prefs.init();
	nodes.clear();
	outlineSections.clear();
	tags.clear();
	publications.clear();
	written = [];
	bulk = [];
	api = useFakeApi();
	installGraph();
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	session.clear();
	// How the notes are seen outlives a mount by design, so it is put back rather
	// than left for whatever runs next.
	prefs.set('seenAs', 'graph');
	tags.select([]);
	target.remove();
	document.body.innerHTML = '';
});

describe('choosing to see the notes as sets', () => {
	it('stands beside the graph and the outline, and is what the canvas is handed', async () => {
		await open();
		expect(field().dataset.arrangement).toBe('genealogy');
		expect(labelled('Sets').getAttribute('aria-pressed')).toBe('false');
		expect(labelled('Sets').closest('[role="group"]')).toBe(
			labelled('Graph').closest('[role="group"]')
		);
		const drawn = field();

		labelled('Sets').click();
		await settle();

		expect(prefs.current.seenAs).toBe('sets');
		expect(labelled('Sets').getAttribute('aria-pressed')).toBe('true');
		expect(labelled('Graph').getAttribute('aria-pressed')).toBe('false');
		// The arrangement is a reading of the same canvas: the field is neither
		// torn down nor put away, so the reader keeps their pan and their zoom.
		expect(canvas()).toBe(drawn);
		expect(drawn.dataset.arrangement).toBe('sets');
		expect(drawn.closest('.invisible')).toBeNull();
	});

	it('stands in the chrome beside the graph as well as over it', async () => {
		await openOnTheDesk();

		const column = document.body.querySelector<HTMLElement>('aside[aria-label="Sloppy"]');
		expect(column).not.toBeNull();
		expect(column?.contains(labelled('Sets'))).toBe(true);

		labelled('Sets').click();
		await settle();

		expect(prefs.current.seenAs).toBe('sets');
	});

	it('is one of the acts, wherever this page offers them', async () => {
		await open();
		const act = acts.all.find((one) => one.id === 'the-sets');
		expect(act?.label).toBe('See the notes as sets');
		expect(act?.where).toEqual(['palette', 'menu']);

		acts.run('the-sets');
		await settle();

		expect(prefs.current.seenAs).toBe('sets');
	});

	it('is still offered once a set of notes is being chosen, as the outline is not', async () => {
		await open();
		await choose('1');

		expect(screen()).toContain('1 note chosen');
		expect(labelled('Sets')).toBeTruthy();
		expect(() => labelled('Outline')).toThrow();
	});

	it('leaves the graph and the outline where they were', async () => {
		await inSets(['biology']);

		labelled('Graph').click();
		await settle();
		expect(field().dataset.arrangement).toBe('genealogy');

		labelled('Outline').click();
		await settle();
		expect(prefs.current.seenAs).toBe('outline');
		expect(field().closest('.invisible')).not.toBeNull();
	});
});

describe('what the canvas says about the sets it is drawing', () => {
	it('asks for tags where none are chosen, and starts with the most used', async () => {
		await inSets();

		expect(screen()).toContain('Choose tags to draw them as sets.');

		says('Start with the three most used').click();
		await settle();

		expect(tags.selected).toEqual(['biology', 'method', 'seed']);
		expect(screen()).not.toContain('Choose tags to draw them as sets.');
	});

	it('says how many of the chosen tags are drawn once there are more than it draws', async () => {
		const eight = ['biology', 'method', 'seed', 'soil', 'question', 'claim', 'hunch', 'working'];
		await inSets(eight);
		expect(screen()).not.toContain('The first eight are drawn.');

		tags.select([...eight, 'settled'] as Tag[]);
		await settle();

		expect(screen()).toContain('The first eight are drawn.');
	});

	it('says none of that in the other readings', async () => {
		await open();

		expect(screen()).not.toContain('Choose tags to draw them as sets.');
	});
});

describe('moving notes between the sets', () => {
	it('writes one note’s whole set, leaving the tags it is not drawn by alone', async () => {
		await inSets(['biology', 'seed']);

		document.body.querySelector<HTMLButtonElement>('[data-drop="1a"]')?.click();
		await settle();

		// `method` is drawn too — it is a tag of this field, selected or not — so a
		// drop in the first set alone takes it off with the rest.
		expect(written).toEqual([{ tags: ['biology'] }]);
		expect(bulk).toEqual([]);
	});

	it('writes several notes as the acts that already act on a chosen set', async () => {
		await inSets(['biology', 'seed']);
		await choose('1', '1a');

		document.body.querySelector<HTMLButtonElement>('[data-drop-chosen]')?.click();
		await settle();

		expect(bulk).toEqual([
			{ notes: [FIRST, SECOND], act: { act: 'tag', tags: ['biology'] } },
			{ notes: [FIRST, SECOND], act: { act: 'untag', tags: ['seed', 'method'] } }
		]);
		expect(written).toEqual([]);
	});

	it('offers a mark’s own menu the way into each drawn set, and out of the ones it is in', async () => {
		await inSets(['biology']);

		await openMenu('1');
		expect(menuRows()).toContain('Out of biology');

		await runRow('Out of biology');

		expect(written).toEqual([{ tags: [] }]);
	});

	it('offers that menu the way in where the note is outside the set', async () => {
		await inSets(['biology']);

		await openMenu('2');
		expect(menuRows()).toContain('Into biology');

		await runRow('Into biology');

		expect(written).toEqual([{ tags: ['biology'] }]);
	});

	it('leaves the fold out, since the notes a subtree holds are spread over the sets', async () => {
		await inSets(['biology']);
		await openMenu('1');
		expect(menuRows()).not.toContain('Fold what is under this');

		labelled('Graph').click();
		await settle();
		await openMenu('1');

		expect(menuRows()).toContain('Fold what is under this');
	});

	it('offers nothing of the sort while the notes are drawn by the genealogy', async () => {
		await open();
		tags.select(['biology'] as Tag[]);
		await settle();

		await openMenu('2');

		expect(menuRows()).not.toContain('Into biology');
	});

	it('carries the same rows in the bar over a chosen set', async () => {
		await inSets(['biology']);
		await choose('1', '2');

		// One of the two is outside it, so the move the set offers is the way in.
		says('Into biology').click();
		await settle();

		expect(bulk).toEqual([{ notes: [FIRST, THIRD], act: { act: 'tag', tags: ['biology'] } }]);
	});

	it('says beside the graph when a move does not land', async () => {
		await inSets(['biology']);
		api.on(`PATCH ${path(THIRD)}`, () => new Response('{}', { status: 500 }));

		await openMenu('2');
		await runRow('Into biology');

		expect(screen()).toContain('Sloppy could not change that note.');
	});

	it('takes that back the moment a move lands', async () => {
		await inSets(['biology']);
		api.on(`PATCH ${path(THIRD)}`, () => new Response('{}', { status: 500 }));
		await openMenu('2');
		await runRow('Into biology');
		expect(screen()).toContain('Sloppy could not change that note.');

		api.on(`PATCH ${path(THIRD)}`, (_url, init) => {
			const after = { ...held.get(THIRD)!, ...JSON.parse(String(init?.body ?? '{}')) } as NodeView;
			held.set(THIRD, after);
			return after;
		});
		await openMenu('2');
		await runRow('Into biology');

		expect(screen()).not.toContain('Sloppy could not change that note.');
	});
});

describe('the fold a set draws where its notes do not all fit', () => {
	it('offers the canvas’s own acts, naming none of the notes standing there', async () => {
		await inSets(['biology']);

		await openMenu('a set');

		expect(menuRows()).toEqual([
			'Choose the note lit up',
			'New note',
			'New branch',
			'Choose notes'
		]);
	});

	it('writes no note’s words on it where a pointer comes to rest', async () => {
		await inSets(['biology']);

		await rest('1');
		expect(preview()?.textContent).toContain('Origins');

		await rest('a set');

		expect(preview()).toBeUndefined();
	});
});
