import type {
	BlockView,
	NoteComment,
	NoteReaction,
	OwnedRef,
	PublicationView,
	PublishedVersion
} from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { conversation } from '../stores/conversation.svelte.js';
import { nodes } from '../stores/nodes.svelte.js';
import { people } from '../stores/people.svelte.js';
import { identity } from '../stores/identity.svelte.js';
import { publications } from '../stores/publications.svelte.js';
import { session } from '../stores/session.svelte.js';
import {
	AT,
	DID,
	node,
	ref,
	useFakeApi,
	VIEWER,
	type FakeApi
} from '../stores/fake-api.test-support.js';
import NoteOnSurface from './note-in-panel.test-support.svelte';

const PEER = 'did:syr:z6MkPeerPeerPeerPeerPeerPeerPeerPeerPeer';

const FIRST = ref(1);
const UNDER = ref(2);
const PUBLICATION = ref(10);
const UNDER_PUBLICATION = ref(11);
const VERSION_ONE = ref(20);
// Seeded away from zero: `ulid(0)` pads to the home graph's own local id.
const OTHER_GRAPH = ref(99);
const VERSION_TWO = ref(21);

const PHONE = 390;

function refPath(of: OwnedRef): string {
	const cut = of.lastIndexOf('/');
	return `/${encodeURIComponent(of.slice(0, cut))}/${encodeURIComponent(of.slice(cut + 1))}`;
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
	for (let frame = 0; frame < 4; frame += 1) await new Promise(requestAnimationFrame);
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

const has = (labelled: string) =>
	[...document.body.querySelectorAll('button')].some((b) => b.textContent?.includes(labelled));

/** Everything on screen as one line: a sentence the markup wrapped is still the
 *  sentence a person reads. */
const says = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

function version(self: OwnedRef, sequence: number, at = AT): PublishedVersion {
	return { ref: self, sequence, published_at: at };
}

function publication(over: Partial<PublicationView> = {}): PublicationView {
	return {
		ref: PUBLICATION,
		created_by: DID,
		created_at: AT,
		updated_at: AT,
		root: FIRST,
		root_address: '1',
		comments: 'anyone',
		latest: version(VERSION_ONE, 1),
		...over
	};
}

function profile(did: string, username: string) {
	return {
		did,
		username,
		display_name: username === 'me' ? 'Me' : 'A Peer',
		bio: null,
		avatar_src: null,
		banner_src: null
	};
}

/** One section of a note, written at `at`. */
function section(of: OwnedRef, words: string, at = AT): BlockView {
	return {
		ref: ref(30),
		created_by: DID,
		created_at: at,
		updated_at: at,
		node: of,
		ord: '0.5',
		content: {
			type: 'doc',
			content: [{ type: 'paragraph', content: [{ type: 'text', text: words }] }]
		}
	};
}

function comment(localId: string, author: string, content: string): NoteComment {
	return {
		comment_id: `${author}:${localId}`,
		author,
		node: FIRST,
		content,
		created_at: AT,
		updated_at: AT
	};
}

let api: FakeApi;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let held: PublicationView[];
let chain: PublishedVersion[];
let said: NoteComment[];
let reacted: NoteReaction[];
/** Where this instance keeps its own identities, which is `VIEWER`'s own only
 *  for somebody whose identity this instance holds itself. */
let ownInstance: string | null;

beforeEach(() => {
	nodes.clear();
	publications.clear();
	conversation.clear();
	identity.clear();
	people.hold(null);
	api = useFakeApi();
	held = [];
	chain = [];
	said = [];
	reacted = [];
	ownInstance = null;

	api.on(`GET /nodes${refPath(FIRST)}`, () => node(1, '1'));
	api.on(`GET /nodes${refPath(FIRST)}/blocks`, () => []);
	api.on(`GET /nodes${refPath(UNDER)}`, () => node(2, '1a', { origin: FIRST, parent: FIRST }));
	api.on(`GET /nodes${refPath(UNDER)}/blocks`, () => []);
	api.on('GET /publications', () => held);
	api.on(`GET /publications${refPath(PUBLICATION)}/versions`, () => chain);
	api.on(`GET /nodes${refPath(FIRST)}/comments`, () => said);
	api.on(`GET /nodes${refPath(FIRST)}/reactions`, () => reacted);
	api.on('GET /profile/me', () => profile(DID, 'me'));
	api.on(`GET /profile/${encodeURIComponent(PEER)}`, () => profile(PEER, 'peer'));
	api.on('GET /emoji/me', () => []);
	api.on('GET /pulls', () => []);
	// Where this instance's own identities live. Answering `null` makes every
	// suite below a person whose identity is kept somewhere that answers for it.
	api.on('GET /auth/own-instance', () => ({ instance_url: ownInstance }));

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

async function open(of: OwnedRef = FIRST): Promise<void> {
	stubViewport(PHONE);
	session.adopt(VIEWER, 'a-session');
	mounted = mount(NoteOnSurface, { target, props: { opened: of, fresh: false } });
	flushSync();
	await settle();
	await until(() => publications.state.loaded || publications.state.failed);
	flushSync();
}

/** The one control every act on a note is asked from. */
async function openActs(): Promise<void> {
	const menu = document.body.querySelector<HTMLButtonElement>(
		'[aria-label="What to do with this note"]'
	);
	if (!menu) throw new Error('The note carries no way to act on it');
	menu.click();
	await settle();
	flushSync();
}

describe('publishing a branch', () => {
	it('is reachable by tapping, from the one control the note keeps', async () => {
		await open();
		await openActs();

		expect(has('Publishing')).toBe(true);
	});

	it('says what publishing exposes before anything is published', async () => {
		await open();
		await openActs();
		button('Publishing').click();
		await settle();
		flushSync();

		expect(says()).toContain('Everything under 1 goes out');
		expect(says()).toContain('finished or not');
		expect(says()).toContain('Anyone who can find your profile can read it');
		expect(says()).toContain('whoever has already read it keeps their copy');
		expect(api.countOf('POST /publications')).toBe(0);
	});

	it('publishes the branch the note is at, and says so afterwards', async () => {
		api.on('POST /publications', () => {
			held = [publication()];
			chain = [version(VERSION_ONE, 1)];
			return held[0];
		});

		await open();
		await openActs();
		button('Publishing').click();
		await settle();
		flushSync();
		button('Publish').click();
		await until(() => publications.all.length === 1);
		await settle();
		flushSync();

		expect(api.calls).toContain('POST /publications');
		expect(says()).toContain('1 is published');
		expect(says()).toContain('Version 1');
	});

	it('names the version on the note itself, without opening anything', async () => {
		held = [publication()];
		chain = [version(VERSION_ONE, 1)];

		await open();
		await until(() => publications.versions(PUBLICATION).length === 1);
		flushSync();

		expect(has('Published · version 1')).toBe(true);
	});

	it('says a branch above it already carries it, where one does', async () => {
		held = [publication()];
		chain = [version(VERSION_ONE, 1)];

		await open(UNDER);
		await openActs();
		button('Publishing').click();
		await settle();
		flushSync();

		expect(says()).toContain('1 already carries this branch');
	});

	it('says nothing about a branch above it where there is none', async () => {
		await open(UNDER);
		await openActs();
		button('Publishing').click();
		await settle();
		flushSync();

		expect(says()).not.toContain('already carries this branch');
	});

	it('leaves a note unpublished where the branch at its address is another graph’s', async () => {
		held = [publication({ graph: OTHER_GRAPH })];
		chain = [version(VERSION_ONE, 1)];

		await open();
		await settle();
		flushSync();

		expect(has('Published · version 1')).toBe(false);
	});

	it('says nothing about a branch above it where that branch is another graph’s', async () => {
		held = [publication({ graph: OTHER_GRAPH })];
		chain = [version(VERSION_ONE, 1)];

		await open(UNDER);
		await openActs();
		button('Publishing').click();
		await settle();
		flushSync();

		expect(says()).not.toContain('already carries this branch');
	});

	it('warns that publishing a tree opens a narrower branch on the tree’s terms', async () => {
		held = [
			publication({
				ref: UNDER_PUBLICATION,
				root: UNDER,
				root_address: '1a',
				comments: 'nobody'
			})
		];

		await open();
		await openActs();
		button('Publishing').click();
		await settle();
		flushSync();

		expect(says()).toContain('1a is published inviting fewer people');
	});

	it('says so rather than describing a branch it could not read anything about', async () => {
		api.on(
			'GET /publications',
			() => new Response('{"message":"Not right now."}', { status: 503 })
		);

		await open();
		await openActs();
		button('Publishing').click();
		await settle();
		flushSync();

		expect(says()).toContain('Not right now.');
	});

	it('says nothing about narrower branches where every one of them is as wide', async () => {
		held = [publication({ ref: UNDER_PUBLICATION, root: UNDER, root_address: '1a' })];

		await open();
		await openActs();
		button('Publishing').click();
		await settle();
		flushSync();

		expect(says()).not.toContain('inviting fewer people');
	});
});

describe('a branch already published', () => {
	beforeEach(() => {
		held = [publication({ latest: version(VERSION_TWO, 2) })];
		chain = [version(VERSION_TWO, 2), version(VERSION_ONE, 1)];
	});

	async function openPublishing(): Promise<void> {
		await open();
		await until(() => publications.versions(PUBLICATION).length === 2);
		await openActs();
		button('Publishing').click();
		await settle();
		flushSync();
	}

	it('names every version of the chain, newest first', async () => {
		await openPublishing();

		expect(says()).toContain('Version 2');
		expect(says()).toContain('Version 1');
	});

	// Offering to publish a branch that is already public — and hiding the way to
	// take it down — is the wrong way round in the one milestone about knowing
	// what is exposed. The version a reader gets is on the listing already.
	it('stands by what is published when the chain behind it will not read', async () => {
		api.on(`GET /publications${refPath(PUBLICATION)}/versions`, () => {
			throw new Error('unreachable');
		});

		await open();
		await openActs();
		button('Publishing').click();
		await settle();
		flushSync();

		expect(says()).toContain('1 is published');
		expect(says()).toContain('Version 2');
		expect(says()).not.toContain('Everything under 1 goes out');
		expect(has('Take it down')).toBe(true);
		expect(says()).toContain('Who may answer');
	});

	it('publishes again, saying that the versions before it stay readable', async () => {
		api.on('POST /publications', () => {
			chain = [version(ref(22), 3), ...chain];
			return publication({ latest: version(ref(22), 3) });
		});

		await openPublishing();
		expect(says()).toContain('Every version before it stays readable');

		button('Publish again').click();
		await until(() => publications.versions(PUBLICATION).length === 3);
		flushSync();

		expect(says()).toContain('Version 3');
	});

	it('says the branch has moved on, where a note in it has been written since', async () => {
		const BEFORE = '2025-12-01T00:00:00.000Z';
		held = [publication({ latest: version(VERSION_TWO, 2, BEFORE) })];
		chain = [version(VERSION_TWO, 2, BEFORE), version(VERSION_ONE, 1, BEFORE)];

		await openPublishing();

		expect(says()).toContain('This branch has changed since then');
	});

	it('says it too where the writing inside a note has moved on', async () => {
		const BEFORE = '2025-12-01T00:00:00.000Z';
		held = [publication({ latest: version(VERSION_TWO, 2, BEFORE) })];
		chain = [version(VERSION_TWO, 2, BEFORE), version(VERSION_ONE, 1, BEFORE)];
		api.on(`GET /nodes${refPath(FIRST)}/blocks`, () => [section(FIRST, 'written since')]);

		await openPublishing();

		expect(says()).toContain('This branch has changed since then');
	});

	it('says nothing about it where every note is as the version left it', async () => {
		await openPublishing();

		expect(says()).not.toContain('has changed since then');
	});

	it('says nothing about it where the sections are as the version left them', async () => {
		const AFTER = '2026-06-01T00:00:00.000Z';
		held = [publication({ latest: version(VERSION_TWO, 2, AFTER) })];
		chain = [version(VERSION_TWO, 2, AFTER), version(VERSION_ONE, 1, AFTER)];
		api.on(`GET /nodes${refPath(FIRST)}/blocks`, () => [section(FIRST, 'published as it stands')]);

		await openPublishing();

		expect(says()).not.toContain('has changed since then');
	});

	it('changes who the author invites to answer', async () => {
		api.on(`PATCH /publications${refPath(PUBLICATION)}`, () => {
			held = [publication({ latest: version(VERSION_TWO, 2), comments: 'nobody' })];
			return held[0];
		});

		await openPublishing();
		button('Nobody').click();
		await until(() => publications.all[0]?.comments === 'nobody');
		flushSync();

		expect(document.body.querySelector('[aria-pressed="true"]')?.textContent).toContain('Nobody');
	});

	it('says what taking it down does, and what it cannot reach', async () => {
		await openPublishing();
		button('Take it down').click();
		await settle();
		flushSync();

		expect(says()).toContain('Take 1 down?');
		expect(says()).toContain('stop opening');
		expect(says()).toContain('keeps their copy of the writing');
	});

	it('takes it down when the question is answered', async () => {
		api.on(`DELETE /publications${refPath(PUBLICATION)}`, () => {
			held = [];
			return undefined;
		});

		await openPublishing();
		button('Take it down').click();
		await settle();
		flushSync();
		[...document.body.querySelectorAll('button')]
			.filter((b) => b.textContent?.includes('Take it down'))
			.at(-1)
			?.click();
		await until(() => publications.all.length === 0);
		flushSync();

		expect(api.calls).toContain(`DELETE /publications${refPath(PUBLICATION)}`);
		expect(has('Published · version')).toBe(false);
	});
});

describe('the conversation on a note', () => {
	it('is not there at all until something published carries the note', async () => {
		await open();

		expect(says()).not.toContain('Conversation');
		expect(api.countOf(`GET /nodes${refPath(FIRST)}/comments`)).toBe(0);
	});

	it('carries what somebody else said on a note of the reader’s own', async () => {
		held = [publication()];
		chain = [version(VERSION_ONE, 1)];
		said = [comment('c1', PEER, 'A thought of my own')];

		await open();
		await until(() => conversation.status(FIRST).loaded);
		await until(() => people.of(PEER) !== null);
		flushSync();

		expect(says()).toContain('Conversation');
		expect(says()).toContain('A thought of my own');
		expect(says()).toContain('A Peer');
	});

	it('never claims to show every answer a note has', async () => {
		held = [publication()];
		chain = [version(VERSION_ONE, 1)];

		await open();
		await until(() => conversation.status(FIRST).loaded);
		flushSync();

		expect(says()).toContain('You see what you and the people you follow have written');
	});

	it('answers a published note, and threads a reply under what it answers', async () => {
		held = [publication()];
		chain = [version(VERSION_ONE, 1)];
		said = [comment('c1', PEER, 'A thought of my own')];
		let sent: unknown;
		api.on('POST /comments', (_url, init) => {
			sent = JSON.parse(String(init?.body));
			return comment('c2', DID, 'Answering that');
		});

		await open();
		await until(() => conversation.status(FIRST).loaded);
		flushSync();
		button('Reply').click();
		flushSync();

		const box = document.body.querySelector<HTMLTextAreaElement>('[aria-label="Say something"]');
		if (!box) throw new Error('Nothing to write an answer in');
		box.value = 'Answering that';
		box.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		button('Post').click();
		await until(() => conversation.comments(FIRST).length === 2);
		flushSync();

		expect(sent).toMatchObject({
			node: FIRST,
			content: 'Answering that',
			reply_to: `${PEER}:c1`
		});
		expect(says()).toContain('Answering that');
	});

	it('is not offered where the author is not taking answers', async () => {
		held = [publication({ comments: 'nobody' })];
		chain = [version(VERSION_ONE, 1)];

		await open();
		await settle();
		flushSync();

		expect(says()).not.toContain('Conversation');
	});

	it('is not offered to somebody whose identity keeps none', async () => {
		ownInstance = VIEWER.syr_instance_url;
		held = [publication()];
		chain = [version(VERSION_ONE, 1)];
		said = [comment('c1', PEER, 'A thought of my own')];

		await open();
		await settle();
		flushSync();

		expect(says()).not.toContain('Conversation');
		expect(says()).not.toContain('Say something');
		expect(api.countOf(`GET /nodes${refPath(FIRST)}/comments`)).toBe(0);
	});
});

describe('publishing where answers cannot come back', () => {
	it('does not promise the author any', async () => {
		ownInstance = VIEWER.syr_instance_url;

		await open();
		await until(() => identity.kind !== undefined);
		await openActs();
		button('Publishing').click();
		await settle();
		flushSync();

		expect(says()).toContain('you will not see them here');
		expect(says()).not.toContain('until you say otherwise here');
	});

	it('promises them where the identity is kept somewhere that answers', async () => {
		await open();
		await until(() => identity.kind !== undefined);
		await openActs();
		button('Publishing').click();
		await settle();
		flushSync();

		expect(says()).toContain('until you say otherwise here');
		expect(says()).not.toContain('you will not see what they say');
	});

	it('still lets the author say who may answer, since readers are offered it', async () => {
		ownInstance = VIEWER.syr_instance_url;
		held = [publication()];
		chain = [version(VERSION_ONE, 1)];

		await open();
		await until(() => identity.kind !== undefined);
		await openActs();
		button('Publishing').click();
		await settle();
		flushSync();

		expect(says()).toContain('Who may answer');
		expect(has('Nobody')).toBe(true);
	});
});
