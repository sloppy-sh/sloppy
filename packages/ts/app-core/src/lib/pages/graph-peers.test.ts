// Reading somebody else's region on the canvas: what is drawn, whose it says it
// is, what one of their notes opens as, and what the surface stops offering
// while it is up.

import type { BlockView, NodeView, NoteComment, OwnedRef, PullView } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	AT,
	conversing,
	DID,
	node,
	ref,
	ulid,
	useFakeApi,
	VIEWER,
	type FakeApi
} from '../stores/fake-api.test-support.js';
import { conversation } from '../stores/conversation.svelte.js';
import { identity } from '../stores/identity.svelte.js';
import { nodes } from '../stores/nodes.svelte.js';
import { peers } from '../stores/peers.svelte.js';
import { people } from '../stores/people.svelte.js';
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
	publication: ref(31, AUTHOR),
	version: { ref: ref(32, AUTHOR), sequence: 1, published_at: AT },
	root_address: '1',
	comments: 'anyone',
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
/** The note under it, which is the one these suites open and answer. */
const THEIRS_UNDER = ref(12, AUTHOR);

function refPath(of: OwnedRef): string {
	const cut = of.lastIndexOf('/');
	return `/${encodeURIComponent(of.slice(0, cut))}/${encodeURIComponent(of.slice(cut + 1))}`;
}

function comment(localId: string, author: string, content: string): NoteComment {
	return {
		comment_id: `${author}:${localId}`,
		author,
		node: THEIRS_UNDER,
		content,
		created_at: AT,
		updated_at: AT
	};
}

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
/** The regions the reader holds, so a suite can vary the author's terms. */
let regions: PullView[];
let said: NoteComment[];
/** Where this instance keeps its own identities: `null` makes the reader
 *  somebody whose identity is kept where it can answer for them. */
let ownInstance: string | null;

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

async function until(ready: () => boolean): Promise<void> {
	for (let turn = 0; turn < 200 && !ready(); turn += 1) {
		await new Promise((wake) => setTimeout(wake));
		flushSync();
	}
	if (!ready()) throw new Error('The surface never settled');
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
	conversation.clear();
	identity.clear();
	people.hold(null);
	api = useFakeApi();
	session.adopt(VIEWER, 'a-token');
	regions = [held];
	said = [];
	ownInstance = null;

	api.on('GET /nodes/tags', () => []);
	api.on('GET /nodes', (url) =>
		url.searchParams.get('origin') === null ? [node(1, '1', { title: 'Mine' })] : []
	);
	api.on('GET /following', () => []);
	api.on('GET /pulls', () => regions);
	api.on(`GET /pulls/${encodeURIComponent(DID)}/${REGION_ID}/nodes`, () => [
		theirs(11, '1', { title: 'Note 1', tags: ['biology'] }),
		theirs(12, '1a', { title: 'Note 1a', origin: THEIR_ROOT, parent: THEIR_ROOT })
	]);
	api.on(`GET /pulls/nodes/${encodeURIComponent(AUTHOR)}/${ulid(12)}/blocks`, () => [
		section(21, ref(12, AUTHOR), 'What they wrote in 1a')
	]);
	api.on(`GET /nodes${refPath(THEIRS_UNDER)}/comments`, () => said);
	api.on(`GET /nodes${refPath(THEIRS_UNDER)}/reactions`, () => []);
	api.on('GET /auth/own-instance', () => ({ instance_url: ownInstance }));
	// What that identity's own store can hold, which is what a conversation is
	// offered on.
	conversing(api);
	api.on('GET /emoji/me', () => []);

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
		api.on('GET /peers/publications', () => ({ did: AUTHOR, publications: [] }));
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

describe('answering somebody else’s note', () => {
	/** Open the region, then the note under its root — the one a peer wrote. */
	async function openTheirNote(): Promise<void> {
		await enterHeldRegion();
		onCanvas('1a').click();
		await settle();
	}

	it('carries what people said on a note its author published', async () => {
		said = [comment('c1', AUTHOR, 'A thought of my own')];

		await openTheirNote();
		await until(() => conversation.status(THEIRS_UNDER).loaded);
		await settle();

		expect(screen()).toContain('Conversation');
		expect(screen()).toContain('A thought of my own');
	});

	it('never claims to show every answer a note has', async () => {
		await openTheirNote();
		await until(() => conversation.status(THEIRS_UNDER).loaded);
		await settle();

		expect(screen()).toContain('You see what you and the people you follow have written');
	});

	it('answers it under the address its own author gave it', async () => {
		let sent: unknown;
		api.on('POST /comments', (_url, init) => {
			sent = JSON.parse(String(init?.body));
			return comment('c2', DID, 'Answering yours');
		});

		await openTheirNote();
		await until(() => conversation.status(THEIRS_UNDER).loaded);
		await settle();

		const box = document.body.querySelector<HTMLTextAreaElement>('[aria-label="Say something"]');
		if (!box) throw new Error('Nothing to write an answer in');
		box.value = 'Answering yours';
		box.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		button('Post').click();
		await until(() => conversation.comments(THEIRS_UNDER).length === 1);
		await settle();

		// The note is the AUTHOR's, so that is who the answer is filed under.
		expect(sent).toMatchObject({ node: THEIRS_UNDER, content: 'Answering yours' });
		expect(screen()).toContain('Answering yours');
	});

	it('is not offered where the author is not taking answers', async () => {
		regions = [{ ...held, comments: 'nobody' }];
		said = [comment('c1', AUTHOR, 'A thought of my own')];

		await openTheirNote();
		await settle();

		expect(screen()).not.toContain('Conversation');
		expect(screen()).not.toContain('A thought of my own');
		expect(api.countOf(`GET /nodes${refPath(THEIRS_UNDER)}/comments`)).toBe(0);
	});

	// The gate is what the reader's own store serves, never where it stands: one
	// that takes a comment and lists none hands back a comment that is gone.
	it('is not offered where the reader’s own store cannot hold one', async () => {
		conversing(api, { converses: { comments: false, reactions: false } });
		said = [comment('c1', AUTHOR, 'A thought of my own')];

		await openTheirNote();
		await settle();

		expect(screen()).not.toContain('Conversation');
		expect(screen()).not.toContain('Say something');
		expect(api.countOf(`GET /nodes${refPath(THEIRS_UNDER)}/comments`)).toBe(0);
	});
});
