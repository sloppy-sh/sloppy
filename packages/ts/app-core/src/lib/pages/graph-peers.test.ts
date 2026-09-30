// Reading somebody else's region on the canvas: what is drawn, whose it says it
// is, what one of their notes opens as, and what the surface stops offering
// while it is up.

import type {
	AnsweredNote,
	BlockView,
	NodeView,
	NoteComment,
	OwnedRef,
	PullView
} from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	AT,
	conversing,
	DID,
	holding,
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
		...node(seed, address, { ...over, created_by: AUTHOR }),
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
/** The reader's own notes strangers answered. */
let answered: AnsweredNote[];
/** Where this instance keeps its own identities: `null` makes the reader
 *  somebody whose identity is kept where it can answer for them. */
let ownInstance: string | null;
/** Put back by whichever case stood in for the clipboard, so the stand-in does
 *  not outlive it. */
let restoreClipboard: (() => void) | undefined;

/** Stands in for the clipboard until the case is over, answering with what the
 *  surface handed it. */
function clipboardKeeps(): string[] {
	const copied: string[] = [];
	const board = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard');
	Object.defineProperty(globalThis.navigator, 'clipboard', {
		configurable: true,
		value: { writeText: (text: string) => (copied.push(text), Promise.resolve()) }
	});
	restoreClipboard = () => {
		if (board) Object.defineProperty(globalThis.navigator, 'clipboard', board);
		else delete (globalThis.navigator as { clipboard?: unknown }).clipboard;
	};
	return copied;
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

/** The control whose whole label is `text`, so a name in a conversation is told
 *  from every surface that merely mentions it. */
function named(text: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].find(
		(b) => b.textContent?.trim() === text
	);
	if (!found) throw new Error(`Nothing on screen is just "${text}"`);
	return found as HTMLButtonElement;
}

function menuItem(label: string): HTMLElement {
	const found = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
		(row) => row.textContent?.trim() === label
	);
	if (!found) throw new Error(`The menu does not offer "${label}"`);
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

/** A note's control on the stand-in canvas, by the title written on it, for one
 *  its author gave no address to find it by. */
function onCanvasNamed(title: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('[aria-label="The graph"] button')].find(
		(b) => b.textContent?.trim() === title
	);
	if (!found) throw new Error(`No note titled ${title} is drawn`);
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

/** Open the graph and raise the sheet the peer surfaces live on. */
async function openPeersSheet(): Promise<void> {
	mounted = mount(Graph, { target });
	flushSync();
	await settle();
	labelledControl('More').click();
	await settle();
	menuItem("Other people's graphs").click();
	await settle();
}

/** Open the graph, then the region held from a peer. */
async function enterHeldRegion(): Promise<void> {
	mounted = mount(Graph, { target });
	flushSync();
	await settle();
	labelledControl('More').click();
	await settle();
	menuItem("Other people's graphs").click();
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
	answered = [];
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
	api.on('GET /answered-notes', () => answered);

	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	session.clear();
	restoreClipboard?.();
	restoreClipboard = undefined;
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
		await until(() => people.unplaced(AUTHOR));
		await settle();
		expect(screen()).toContain('Somebody');
		expect(screen()).not.toContain('z6MkpTHR…MxYZ');
		button('Your graph').click();
		await settle();
		expect(drawn()).toEqual(['1']);
		expect(button('New note')).toBeTruthy();
	});

	it('calls the author the same thing on the note it opens', async () => {
		await enterHeldRegion();
		await until(() => people.unplaced(AUTHOR));
		onCanvas('1a').click();
		await settle();
		expect(screen()).toContain('Somebody wrote this');
	});

	it('offers nothing that would change somebody else’s note', async () => {
		await enterHeldRegion();
		expect(choosingOnCanvas()).toBeUndefined();
		expect(() => button('New note')).toThrow();
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

	// The copy is what the reader has. Nothing they do to it fetches the picture
	// from its author, so there is no second try to offer.
	it('says a picture the copy did not bring is not readable here', async () => {
		api.on(`GET /pulls/nodes/${encodeURIComponent(AUTHOR)}/${ulid(12)}/blocks`, () => [
			{
				...section(21, THEIRS_UNDER, 'What they wrote in 1a'),
				content: {
					type: 'doc',
					content: [{ type: 'picture', attrs: { upload_id: ref(50, AUTHOR) } }]
				}
			}
		]);

		await enterHeldRegion();
		onCanvas('1a').click();
		await until(
			() => (document.body.querySelector('.sloppy-picture-note')?.textContent ?? '') !== ''
		);

		const note = document.body.querySelector('.sloppy-picture-note')?.textContent ?? '';
		expect(note).toContain("isn't readable here");
		expect(note).not.toContain('Open the note again');
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
		labelledControl('More').click();
		await settle();
		menuItem("Other people's graphs").click();
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

	// A person hands somebody their name, not an identifier, and where it is
	// kept comes with it.
	it('finds somebody by a name and the instance it is kept on', async () => {
		api.on('GET /peers/identity', () => ({ did: STRANGER }));
		api.on('GET /peers/publications', () => ({ did: STRANGER, publications: [] }));
		await openPeersSheet();

		const who = document.body.querySelector<HTMLInputElement>('[aria-label="Who to read"]');
		if (!who) throw new Error('There is nowhere to say who to read');
		who.value = 'charles@peer.example';
		who.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		button('See what they publish').click();
		await settle();

		const looked = api.calls.find((call) => call.startsWith('GET /peers/identity'));
		expect(looked).toBeDefined();
		const asked = new URL(looked!, 'http://api.test').searchParams;
		expect(asked.get('name')).toBe('charles');
		expect(asked.get('source_url')).toBe('https://peer.example');

		// Whoever the name turned out to be is who a follow is written against.
		expect(api.calls).toContain(
			`GET /peers/publications?did=${encodeURIComponent(STRANGER)}` +
				`&source_url=${encodeURIComponent('https://peer.example')}`
		);
		expect(screen()).toContain(STRANGER);
	});

	it('says a name or an identifier is what the field takes', async () => {
		await openPeersSheet();

		expect(screen()).toContain('Paste what they gave you');
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

	// A voice on a held note is a person the reader can go on to read.
	it('opens whoever spoke, and what they publish, from their name', async () => {
		said = [comment('c1', STRANGER, 'A thought of my own')];
		api.on(`GET /profile/${encodeURIComponent(STRANGER)}`, () => ({
			did: STRANGER,
			username: 'charles',
			display_name: 'Charles Babbage',
			bio: null,
			avatar_src: null,
			banner_src: null
		}));
		api.on('GET /peers/publications', () => ({
			did: STRANGER,
			publications: [
				{
					ref: ref(41, STRANGER),
					root_address: '2b',
					title: 'What they think about it',
					latest: { ref: ref(42, STRANGER), sequence: 1, published_at: AT }
				}
			]
		}));

		await openTheirNote();
		await until(() => conversation.status(THEIRS_UNDER).loaded);
		await until(() => people.of(STRANGER) !== null);
		await settle();
		named('Charles Babbage').click();
		await until(() => screen().includes('What they think about it'));

		expect(screen()).toContain('2b');
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

describe('what the reader is holding', () => {
	/** The chain the author's instance serves, newest first. */
	function publishes(sequence: number): void {
		api.on('GET /peers/versions', () => ({
			publication: held.publication,
			versions: [{ ref: ref(40 + sequence, AUTHOR), sequence, published_at: AT }]
		}));
	}

	it('says which version it holds, and that the author has moved past it', async () => {
		publishes(3);
		await openPeersSheet();
		await until(() => screen().includes('Version 3 is out'));

		expect(screen()).toContain('Version 1, read');
		expect(screen()).toContain('Version 3 is out');
	});

	it('says nothing about a newer one where it holds the newest', async () => {
		publishes(1);
		await openPeersSheet();
		await settle();

		expect(screen()).toContain('Version 1, read');
		expect(screen()).not.toContain('is out');
		expect(() => button('What changed')).toThrow();
	});

	it('shows what changed between the copy held and the one that is out', async () => {
		publishes(3);
		api.on('GET /peers/changes', () => ({
			publication: held.publication,
			root_address: held.root_address,
			from: held.version.ref,
			to: ref(43, AUTHOR),
			changes: [
				{
					change: 'added',
					note: {
						ref: ref(13, AUTHOR),
						address: '1b',
						parent: THEIR_ROOT,
						origin: THEIR_ROOT,
						title: 'A new thought',
						tags: [],
						links: [],
						created_at: AT,
						updated_at: AT
					},
					sections: []
				}
			]
		}));

		await openPeersSheet();
		await until(() => screen().includes('Version 3 is out'));
		button('What changed').click();
		await until(() => screen().includes('A new thought'));

		expect(api.calls.some((call) => call.startsWith('GET /peers/changes'))).toBe(true);
		expect(screen()).toContain('1b');
	});

	it('takes the copy again from the instance it came from, without leaving the sheet', async () => {
		let asked: unknown;
		publishes(3);
		api.on('POST /pulls', (_url, init) => {
			asked = JSON.parse(String(init?.body));
			return held;
		});
		await openPeersSheet();
		await settle();

		labelledControl(`Read ${held.root_address} again`).click();
		await until(() => asked !== undefined);
		await settle();

		expect(asked).toMatchObject({ publication: held.publication, source_url: held.source_url });
		// The copy is taken where the reader already was.
		expect(screen()).toContain('What you are holding');
	});

	it('tells two of one author’s notebooks apart by the names they travelled with', async () => {
		const second = `${DID}/01JQXR000000000000000000RH` as OwnedRef;
		regions = [
			{ ...held, graph: ref(90, AUTHOR), graph_title: 'The thesis' },
			{
				...held,
				ref: second,
				publication: ref(33, AUTHOR),
				graph: ref(91, AUTHOR),
				graph_title: 'The garden'
			}
		];

		await openPeersSheet();
		await settle();

		expect(screen()).toContain('The thesis');
		expect(screen()).toContain('The garden');
		// The notebook is named, never the thing that keys it.
		expect(screen()).not.toContain(ulid(90));
	});

	it('names the notebook a region is read in while it is on the canvas', async () => {
		regions = [{ ...held, graph: ref(90, AUTHOR), graph_title: 'The thesis' }];

		await enterHeldRegion();

		expect(screen()).toContain('The thesis');
	});
});

describe('the reader’s own notes somebody answered', () => {
	it('lists them without a count, and opens the note the answer is on', async () => {
		answered = [{ note: ref(1), address: '1', graph: ref(80), title: 'Mine', voices: [AUTHOR] }];

		await openPeersSheet();
		await until(() => screen().includes('Answers on your notes'));

		expect(screen()).toContain('Mine');
		expect(screen()).not.toContain('1 answer');
		button('Mine').click();
		await settle();

		expect(at.note).toBe(ref(1));
	});

	it('never claims to be every answer the notes have', async () => {
		answered = [{ note: ref(1), address: '1', graph: ref(80), title: 'Mine', voices: [AUTHOR] }];

		await openPeersSheet();
		await until(() => screen().includes('Answers on your notes'));

		expect(screen()).toContain('From people you do not follow');
	});

	it('names whoever answered, where this instance can place them', async () => {
		regions = [];
		answered = [{ note: ref(1), address: '1', graph: ref(80), title: 'Mine', voices: [AUTHOR] }];
		api.on(`GET /profile/${encodeURIComponent(AUTHOR)}`, () => ({
			did: AUTHOR,
			username: 'alice',
			display_name: 'Alice Author',
			bio: null,
			avatar_src: null,
			banner_src: null
		}));

		await openPeersSheet();
		await until(() => screen().includes('Alice Author'));

		expect(screen()).not.toContain(AUTHOR);
	});
});

describe('a citation to somebody else’s note', () => {
	const path = `/n/${encodeURIComponent(AUTHOR)}/${ulid(12)}`;

	it('opens the note in the region the reader holds a copy of it in', async () => {
		holding(api, [
			{
				note: theirs(12, '1a', { title: 'Note 1a', origin: THEIR_ROOT, parent: THEIR_ROOT }),
				pull: held
			}
		]);
		startAt(path);

		mounted = mount(Graph, { target });
		flushSync();
		await until(() => screen().includes('What they wrote in 1a'));

		expect(screen()).toContain('Note 1a');
		expect(drawn()).toEqual(['1', '1a']);
	});

	it('offers the branch that carries it where the reader holds no copy', async () => {
		api.on(`GET /pulls/nodes/${encodeURIComponent(AUTHOR)}/${ulid(12)}`, () => null);
		api.on('GET /peers/publications', () => ({
			did: AUTHOR,
			publications: [
				{
					ref: ref(31, AUTHOR),
					root_address: '1',
					title: 'What they wrote',
					latest: { ref: ref(32, AUTHOR), sequence: 1, published_at: AT }
				}
			]
		}));
		regions = [];
		startAt(path);

		mounted = mount(Graph, { target });
		flushSync();
		await until(() => screen().includes('What they wrote'));

		// The sheet is up, asking about the person whose note was cited.
		expect(api.calls.some((call) => call.includes(`did=${encodeURIComponent(AUTHOR)}`))).toBe(true);
		expect(screen()).not.toContain('may have taken it down');
		expect(screen()).toContain('Read it');
	});

	it('asks about them where the reader already knows their graph is kept', async () => {
		api.on('GET /following', () => [{ did: AUTHOR, provider_url: 'https://theirs.example' }]);
		api.on(`GET /pulls/nodes/${encodeURIComponent(AUTHOR)}/${ulid(12)}`, () => null);
		api.on('GET /peers/publications', () => ({ did: AUTHOR, publications: [] }));
		regions = [];
		startAt(path);

		mounted = mount(Graph, { target });
		flushSync();
		await until(() =>
			api.calls.some(
				(call) =>
					call.startsWith('GET /peers/publications') &&
					call.includes('source_url=https%3A%2F%2Ftheirs.example')
			)
		);
	});
});

describe('a note of the reader’s own, off one they are holding', () => {
	it('writes it in their own notebook, citing the note they were reading', async () => {
		let written: unknown;
		api.on('POST /nodes', () => node(50, '2', { title: '' }));
		api.on(`PATCH /nodes${refPath(ref(50))}`, (_url, init) => {
			written = JSON.parse(String(init?.body));
			return node(50, '2', { links: [THEIRS_UNDER] });
		});

		await enterHeldRegion();
		onCanvas('1a').click();
		await settle();
		button('Write a note of your own').click();
		await until(() => written !== undefined);
		await settle();

		expect(written).toEqual({ links: [THEIRS_UNDER] });
		// Their region is behind the reader now, on their own graph.
		expect(drawn()).toEqual(['1', '2']);
	});

	it('leaves nothing behind in their notebook when it cannot be made to cite', async () => {
		let gone = false;
		api.on('POST /nodes', () => node(50, '2', { title: '' }));
		api.on(
			`PATCH /nodes${refPath(ref(50))}`,
			() => new Response('{"message":"That note could not be changed."}', { status: 500 })
		);
		api.on(`DELETE /nodes${refPath(ref(50))}`, () => {
			gone = true;
			return undefined;
		});

		await enterHeldRegion();
		onCanvas('1a').click();
		await settle();
		button('Write a note of your own').click();
		await until(() => gone);
		await settle();

		expect(screen()).toContain('That note could not be changed.');
	});

	it('copies the address a peer would resolve, with the notebook it is read in', async () => {
		const copied = clipboardKeeps();
		regions = [{ ...held, graph: ref(90, AUTHOR), graph_title: 'The thesis' }];

		await enterHeldRegion();
		onCanvas('1a').click();
		await settle();
		labelledControl("Copy this note's address").click();
		await settle();

		expect(copied).toEqual(['1a · The thesis']);
	});

	// Their author gave it no address, so there is nothing to cite — what the
	// reader can still hand somebody is the way to open it.
	it('hands over a link where the note its author wrote carries no address', async () => {
		const copied = clipboardKeeps();
		const bare = theirs(13, '1b', { title: 'Nothing numbered it', parent: THEIR_ROOT });
		delete bare.address;
		api.on(`GET /pulls/${encodeURIComponent(DID)}/${REGION_ID}/nodes`, () => [
			theirs(11, '1', { title: 'Note 1' }),
			bare
		]);

		await enterHeldRegion();
		onCanvasNamed('Nothing numbered it').click();
		await settle();
		labelledControl('Copy a link to this note').click();
		await settle();

		expect(copied).toEqual([
			`${globalThis.location.origin}/n/${encodeURIComponent(AUTHOR)}/${ulid(13)}`
		]);
	});
});

describe('somebody nobody here could place', () => {
	it('is drawn as the identifier they travel by, settled', async () => {
		api.on('GET /following', () => [{ did: STRANGER, provider_url: 'https://theirs.example' }]);

		await openPeersSheet();
		await until(() => people.unplaced(STRANGER));
		await settle();

		expect(screen()).toContain(STRANGER);
		// Nothing is still on its way, so nothing shimmers as though it were.
		expect(document.body.querySelector('[data-slot="skeleton"]')).toBeNull();
	});
});
