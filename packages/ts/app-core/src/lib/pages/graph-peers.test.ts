// Reading somebody else's region on the canvas: what is drawn, whose it says it
// is, what one of their notes opens as, and what the surface stops offering
// while it is up.

import type { BlockView, NodeView, OwnedRef, PullView } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	AT,
	DID,
	node,
	ref,
	ulid,
	useFakeApi,
	VIEWER,
	type FakeApi
} from '../stores/fake-api.test-support.js';
import { nodes } from '../stores/nodes.svelte.js';
import { peers } from '../stores/peers.svelte.js';
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

const AUTHOR = 'did:syr:z6MkpTHR8VNsBxYAAWHut2Geadd9jSLuFvdmsZ2mFmZjMxYZ';
/** Somebody the reader follows and holds nothing from. */
const STRANGER = 'did:syr:z6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJG';
const REGION_ID = '01JQXR000000000000000000RG';
const REGION = `${DID}/${REGION_ID}` as OwnedRef;

const held: PullView = {
	ref: REGION,
	created_by: DID,
	source_did: AUTHOR,
	root_address: '1',
	source_url: 'http://peer.test',
	created_at: AT,
	updated_at: AT
};

/** A note as it comes back from a held region: addressed by its AUTHOR, and
 *  `published` because that was true of it when the copy arrived. */
function theirs(seed: number, address: string, over: Partial<NodeView> = {}): NodeView {
	const self = ref(seed, AUTHOR);
	return {
		...node(seed, address, over),
		ref: self,
		created_by: AUTHOR,
		origin: over.origin ?? self,
		published: true,
		...over
	};
}

const THEIR_ROOT = ref(11, AUTHOR);

/** An address a peer would like the reader's browser to fetch. */
const TRACKER = 'https://tracker.example/p.png';

/** One section of a held note, as the region served it. */
function section(seed: number, note: OwnedRef, words: string): BlockView {
	return {
		ref: ref(seed, AUTHOR),
		created_by: AUTHOR,
		created_at: AT,
		updated_at: AT,
		node: note,
		ord: 'a0',
		content: {
			type: 'doc',
			content: [{ type: 'paragraph', content: [{ type: 'text', text: words }] }]
		}
	};
}

let api: FakeApi;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

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

function button(labelled: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].find((b) =>
		b.textContent?.includes(labelled)
	);
	if (!found) throw new Error(`No "${labelled}" button on screen`);
	return found;
}

function labelledControl(label: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].find(
		(b) => b.getAttribute('aria-label') === label
	);
	if (!found) throw new Error(`Nothing on screen is labelled "${label}"`);
	return found as HTMLButtonElement;
}

const drawn = (): string[] =>
	[...document.body.querySelectorAll('[data-expand]')].map(
		(mark) => mark.getAttribute('data-expand') ?? ''
	);

/** A note's control on the stand-in canvas, by the address it carries. */
function onCanvas(address: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('[aria-label="The graph"] button')].find(
		(b) => b.textContent?.trim().split(/\s+/)[0] === address
	);
	if (!found) throw new Error(`No note addressed ${address} is drawn`);
	return found as HTMLButtonElement;
}

/** The nth "What they publish", which is the nth person the reader follows. */
function publishedByRow(at: number): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].filter((b) =>
		b.textContent?.includes('What they publish')
	);
	if (!found[at]) throw new Error(`No ${at + 1}th person to ask about`);
	return found[at] as HTMLButtonElement;
}

const choosingOnCanvas = () =>
	document.body.querySelector<HTMLElement>('[aria-label="The graph"]')?.dataset.choosing;

const screen = () => document.body.textContent ?? '';

/** Open the graph, then the region held from a peer. */
async function enterHeldRegion(): Promise<void> {
	mounted = mount(Graph, { target });
	flushSync();
	await settle();
	labelledControl("Other people's graphs").click();
	await settle();
	// The row for the region, which names its author where nobody can resolve
	// them and its address either way.
	button(AUTHOR).click();
	await settle();
}

beforeEach(() => {
	startAt('/');
	stubViewport();
	nodes.clear();
	tags.clear();
	// Held regions outlive a component, so one test's copy is another's unless
	// this runs: what a region served is read once and kept for the session.
	peers.clear();
	api = useFakeApi();
	session.adopt(VIEWER, 'a-token');

	api.on('GET /nodes/tags', () => []);
	api.on('GET /nodes', (url) =>
		url.searchParams.get('origin') === null ? [node(1, '1', { title: 'Mine' })] : []
	);
	api.on('GET /following', () => []);
	api.on('GET /pulls', () => [held]);
	api.on(`GET /pulls/${encodeURIComponent(DID)}/${REGION_ID}/nodes`, () => [
		theirs(11, '1', { title: 'Note 1', tags: ['biology'] }),
		theirs(12, '1a', { title: 'Note 1a', origin: THEIR_ROOT, parent: THEIR_ROOT })
	]);
	api.on(`GET /pulls/nodes/${encodeURIComponent(AUTHOR)}/${ulid(12)}/blocks`, () => [
		section(21, ref(12, AUTHOR), 'What they wrote in 1a')
	]);

	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	session.clear();
	target.remove();
});

describe('a region of somebody else’s graph, on the canvas', () => {
	it('draws the author’s notes at the addresses they gave them', async () => {
		await enterHeldRegion();
		expect(drawn()).toEqual(['1', '1a']);
	});

	it('says whose branch it is, and how to get back', async () => {
		await enterHeldRegion();
		expect(screen()).toContain(AUTHOR);
		button('Your graph').click();
		await settle();
		expect(drawn()).toEqual(['1']);
		expect(button('New branch')).toBeTruthy();
	});

	it('offers nothing that would change somebody else’s note', async () => {
		await enterHeldRegion();
		expect(choosingOnCanvas()).toBeUndefined();
		expect(() => button('New branch')).toThrow();
		document.body.querySelector<HTMLButtonElement>('[data-menu="1a"]')?.click();
		await settle();
		expect(document.body.querySelectorAll('[role="menuitem"]')).toHaveLength(0);
	});

	it('never asks for the reader’s own notes while a region is up', async () => {
		await enterHeldRegion();
		expect(api.calls.some((call) => call.startsWith('PATCH /nodes'))).toBe(false);
		expect(api.calls.some((call) => call.startsWith('POST /nodes'))).toBe(false);
	});

	it('opens the note a held mark stands for, in the author’s own words', async () => {
		await enterHeldRegion();
		onCanvas('1a').click();
		await settle();
		expect(screen()).toContain('Note 1a');
		expect(screen()).toContain('What they wrote in 1a');
	});

	it('offers no way to write in a note it is showing', async () => {
		await enterHeldRegion();
		onCanvas('1a').click();
		await settle();
		expect(document.body.querySelector('[aria-label="Title"]')).toBeNull();
		expect(document.body.querySelector('[contenteditable="true"]')).toBeNull();
		expect(api.calls.some((call) => call.startsWith('PATCH /blocks'))).toBe(false);
		expect(api.calls.some((call) => call.startsWith('POST /blocks'))).toBe(false);
	});

	it('fetches no address a peer put in a note it is showing', async () => {
		api.on(`GET /pulls/nodes/${encodeURIComponent(AUTHOR)}/${ulid(12)}/blocks`, () => [
			{
				...section(21, ref(12, AUTHOR), 'What they wrote in 1a'),
				content: {
					type: 'doc',
					content: [
						{ type: 'picture', attrs: { preview: TRACKER, failure: 'Call this number' } },
						{
							type: 'paragraph',
							content: [{ type: 'emoji', attrs: { name: 'wave', char: '', src: TRACKER } }]
						}
					]
				}
			}
		]);
		await enterHeldRegion();
		onCanvas('1a').click();
		await settle();

		expect(document.body.innerHTML).not.toContain(TRACKER);
	});

	it('asks about somebody the reader follows where their graph is', async () => {
		api.on('GET /following', () => [
			{ did: AUTHOR, provider_url: 'https://recorded.example' },
			{ did: STRANGER, provider_url: 'https://theirs.example' }
		]);
		api.on('GET /peers/publications', () => ({ did: AUTHOR, roots: [] }));
		mounted = mount(Graph, { target });
		flushSync();
		await settle();
		labelledControl("Other people's graphs").click();
		await settle();

		const asking = (who: string, where: string) =>
			`GET /peers/publications?did=${encodeURIComponent(who)}&source_url=${encodeURIComponent(where)}`;

		// Somebody whose graph nothing here has read is asked at the instance
		// their DID was recorded against.
		publishedByRow(1).click();
		await settle();
		expect(api.calls).toContain(asking(STRANGER, 'https://theirs.example'));

		// Somebody a region is already held from is asked where that came from,
		// and not at whatever the box was left holding for the last person.
		publishedByRow(0).click();
		await settle();
		expect(api.calls).toContain(asking(AUTHOR, 'http://peer.test'));
	});

	it('counts the region’s own tags on the rail, not the reader’s', async () => {
		api.on('GET /nodes/tags', () => [{ tag: 'biology', notes: 412 }]);
		await enterHeldRegion();
		expect(screen()).not.toContain('412');
		expect(screen()).toContain('biology');
	});
});
