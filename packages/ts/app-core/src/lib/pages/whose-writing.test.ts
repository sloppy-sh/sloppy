import type { BlockView, NodeView, OwnedRef, ProfileView } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	AT,
	DID,
	amending,
	amendment,
	node,
	ref,
	useFakeApi,
	VIEWER,
	type FakeApi
} from '../stores/fake-api.test-support.js';
import { nodes } from '../stores/nodes.svelte.js';
import { offers } from '../stores/offers.svelte.js';
import { peers } from '../stores/peers.svelte.js';
import { people } from '../stores/people.svelte.js';
import { session } from '../stores/session.svelte.js';
import NoteOnSurface from './note-in-panel.test-support.svelte';

const KEEPER = 'did:syr:z6MkjChhrJfLm9WGVUAnyLPnfPGmZDcyDKNsBTsAsn7RkAqB';
const THEIRS: OwnedRef = ref(1, KEEPER);
const MINE: OwnedRef = ref(2);

const THEM: ProfileView = {
	did: KEEPER,
	username: 'charles',
	display_name: 'Charles Babbage',
	bio: null,
	avatar_src: null,
	banner_src: null
};

function refPath(of: OwnedRef): string {
	const cut = of.lastIndexOf('/');
	return `/${encodeURIComponent(of.slice(0, cut))}/${encodeURIComponent(of.slice(cut + 1))}`;
}

function words(said: string) {
	return {
		type: 'doc' as const,
		content: [{ type: 'paragraph', content: [{ type: 'text', text: said }] }]
	};
}

function section(seed: number, of: OwnedRef, said: string): BlockView {
	return {
		ref: ref(seed, of.slice(0, of.lastIndexOf('/'))),
		created_by: of.slice(0, of.lastIndexOf('/')),
		node: of,
		ord: '000',
		content: words(said),
		created_at: AT,
		updated_at: AT
	};
}

const OPENING = section(10, THEIRS, 'The seed of the argument');
const MY_OPENING = section(20, MINE, 'What I think');

function stubViewport(width = 390): void {
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: (query: string) => ({
			matches: /min-width:\s*(\d+)px/.test(query)
				? width >= Number(/min-width:\s*(\d+)px/.exec(query)![1])
				: false,
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
	for (let turn = 0; turn < 12; turn += 1) {
		await new Promise((wake) => setTimeout(wake));
		flushSync();
	}
}

const screen = () => document.body.textContent ?? '';
const title = () => document.body.querySelector<HTMLTextAreaElement>('[aria-label="Title"]');

function button(reads: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].find((one) =>
		one.textContent?.includes(reads)
	);
	if (!found) throw new Error(`No "${reads}" button on screen`);
	return found;
}

const acts = () =>
	document.body.querySelector<HTMLButtonElement>('button[aria-label="What to do with this note"]');

function noButton(reads: string): boolean {
	return ![...document.body.querySelectorAll('button')].some((one) =>
		one.textContent?.includes(reads)
	);
}

let api: FakeApi;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

/** Their note, which only they write, with one section in it. */
function theirNote(over: Partial<NodeView> = {}): NodeView {
	return {
		...node(1, '1', { created_by: KEEPER, owner: KEEPER }),
		ref: THEIRS,
		title: 'The opening',
		...over
	};
}

/** The reader's own note, which nobody gates. */
function myNote(over: Partial<NodeView> = {}): NodeView {
	return { ...node(2, '2'), ref: MINE, title: 'Mine', ...over };
}

function serve(note: NodeView, stack: readonly BlockView[]): void {
	api.on(`GET /nodes${refPath(note.ref)}`, () => note);
	api.on(`GET /nodes${refPath(note.ref)}/blocks`, () => [...stack]);
}

async function open(of: OwnedRef): Promise<void> {
	mounted = mount(NoteOnSurface, { target, props: { opened: of, fresh: false } });
	flushSync();
	await settle();
}

beforeEach(() => {
	stubViewport();
	api = useFakeApi();
	nodes.clear();
	offers.clear();
	peers.clear();
	people.hold(null);
	session.clear();
	session.adopt(VIEWER, 'a-session');
	api.on(`GET /profile/${encodeURIComponent(KEEPER)}`, () => THEM);
	api.on('GET /following', () => []);
	api.on('GET /pulls', () => []);
	api.on('GET /publications', () => []);
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.body.innerHTML = '';
});

describe('a note somebody else writes', () => {
	beforeEach(() => {
		serve(theirNote(), [OPENING]);
		amending(api, { [THEIRS]: [] }, () => theirNote());
	});

	it('says whose it is and what a write here does, before anything is written', async () => {
		await open(THEIRS);

		expect(screen()).toContain('Only Charles Babbage writes this note.');
		expect(screen()).toContain('What you write here is offered to them.');
	});

	it('offers nothing about the note’s place: no link, no delete', async () => {
		await open(THEIRS);
		acts()?.click();
		await settle();

		expect(noButton('Link to another note')).toBe(true);
		expect(noButton('Delete this note')).toBe(true);
	});

	it('keeps a title typed here off the note, and offers it instead', async () => {
		await open(THEIRS);
		const field = title();
		if (!field) throw new Error('The note has no title');

		field.value = 'A clearer opening';
		field.dispatchEvent(new Event('input', { bubbles: true }));
		field.dispatchEvent(new Event('blur', { bubbles: true }));
		await settle();

		expect(api.countOf(`PATCH /nodes${refPath(THEIRS)}`)).toBe(0);
		expect(button('Offer this change')).toBeDefined();
	});

	it('offers the change, and says what happened in one sentence', async () => {
		await open(THEIRS);
		const field = title();
		if (!field) throw new Error('The note has no title');
		field.value = 'A clearer opening';
		field.dispatchEvent(new Event('input', { bubbles: true }));
		field.dispatchEvent(new Event('blur', { bubbles: true }));
		await settle();

		button('Offer this change').click();
		await settle();
		button('Offer it').click();
		await settle();

		expect(api.countOf('POST /amendments')).toBe(1);
		expect(screen()).toContain('Offered to Charles Babbage. It shows once they take it.');
	});

	// DESIGN.md § "Persistence": what has not reached Sloppy is on the device
	// until it does, and a change offered on somebody else's note is no different.
	it('still holds what was written here when the app comes back to it', async () => {
		await open(THEIRS);
		const field = title();
		if (!field) throw new Error('The note has no title');
		field.value = 'A clearer opening';
		field.dispatchEvent(new Event('input', { bubbles: true }));
		field.dispatchEvent(new Event('blur', { bubbles: true }));
		await settle();

		unmount(mounted!, { outro: false });
		mounted = undefined;
		offers.clear();
		await open(THEIRS);

		expect(title()?.value).toBe('A clearer opening');
		expect(button('Offer this change')).toBeDefined();
	});

	it('shows the offer already standing here, and takes it back', async () => {
		const standing = amendment(60, THEIRS, DID, {
			created_by: KEEPER,
			title: 'As I would have it'
		});
		amending(api, { [THEIRS]: [standing] }, () => theirNote());
		await open(THEIRS);

		expect(screen()).toContain('Your change is offered on it now.');
		expect(title()?.value).toBe('As I would have it');

		button('Take it back').click();
		await settle();

		expect(api.countOf(`DELETE /amendments${refPath(standing.ref)}`)).toBe(1);
		expect(noButton('Take it back')).toBe(true);
	});
});

describe('a note the reader writes', () => {
	it('says nothing about who writes it while nobody gates it', async () => {
		serve(myNote(), [MY_OPENING]);
		await open(MINE);

		expect(screen()).not.toContain('writes this note');
		expect(screen()).not.toContain('Offered changes');
	});

	it('writes a title straight into the note', async () => {
		serve(myNote(), [MY_OPENING]);
		api.on(`PATCH /nodes${refPath(MINE)}`, (_url, init) => ({
			...myNote(),
			...(JSON.parse(String(init?.body)) as Partial<NodeView>)
		}));
		await open(MINE);
		const field = title();
		if (!field) throw new Error('The note has no title');

		field.value = 'Mine, retitled';
		field.dispatchEvent(new Event('input', { bubbles: true }));
		field.dispatchEvent(new Event('blur', { bubbles: true }));
		await settle();

		expect(api.countOf(`PATCH /nodes${refPath(MINE)}`)).toBe(1);
	});

	it('reserves the note to the reader, and says so', async () => {
		serve(myNote(), [MY_OPENING]);
		api.on(`PATCH /nodes${refPath(MINE)}`, (_url, init) => ({
			...myNote(),
			...(JSON.parse(String(init?.body)) as Partial<NodeView>)
		}));
		amending(api, { [MINE]: [] }, () => myNote());
		await open(MINE);

		acts()?.click();
		await settle();
		button('Who writes this note').click();
		await settle();
		button('Only you').click();
		await settle();

		expect(screen()).toContain('Only you write this');
	});
});

describe('a note in the reader’s own graph that somebody else writes', () => {
	beforeEach(() => {
		serve(myNote({ owner: KEEPER }), [MY_OPENING]);
		amending(api, { [MINE]: [] }, () => myNote({ owner: KEEPER }));
	});

	it('says whose writing it is, and offers a change like any contributor', async () => {
		await open(MINE);

		expect(screen()).toContain('Only Charles Babbage writes this note.');
	});

	it('keeps the note’s place theirs: it moves and it goes, its writing is offered', async () => {
		await open(MINE);
		acts()?.click();
		await settle();

		expect(button('Move this note')).toBeDefined();
		expect(button('Delete this note')).toBeDefined();
		expect(noButton('Link to another note')).toBe(true);
	});
});

describe('the changes offered on the reader’s own note', () => {
	const offered = amendment(70, MINE, KEEPER, {
		title: 'Mine, as they would have it',
		message: 'Reads better this way',
		blocks: [{ ref: MY_OPENING.ref, content: words('What they think') }]
	});

	beforeEach(() => {
		serve(myNote({ owner: DID }), [MY_OPENING]);
		amending(api, { [MINE]: [offered] }, () => myNote({ owner: DID, contributors: [KEEPER] }));
	});

	it('counts them beside the note, and reads one as a difference', async () => {
		await open(MINE);

		expect(screen()).toContain('Offered changes (1)');
		button('Offered changes (1)').click();
		await settle();
		button('Reads better this way').click();
		await settle();

		expect(screen()).toContain('What I think');
		expect(screen()).toContain('What they think');
		expect(screen()).toContain('Mine, as they would have it');
	});

	it('takes one in whole, and reads the note again', async () => {
		serve(myNote({ owner: DID }), [MY_OPENING]);
		api.on(`GET /nodes${refPath(MINE)}/blocks`, () => [
			{ ...MY_OPENING, content: words('What they think') }
		]);
		await open(MINE);

		button('Offered changes (1)').click();
		await settle();
		button('Reads better this way').click();
		await settle();
		button('Take it in').click();
		await settle();

		expect(api.countOf(`POST /amendments${refPath(offered.ref)}/approve`)).toBe(1);
		expect(screen()).toContain('Taken in.');
		expect(screen()).not.toContain('Offered changes (1)');
	});

	it('turns one down and keeps nothing of it', async () => {
		await open(MINE);

		button('Offered changes (1)').click();
		await settle();
		button('Reads better this way').click();
		await settle();
		button('Turn it down').click();
		await settle();

		expect(api.countOf(`POST /amendments${refPath(offered.ref)}/decline`)).toBe(1);
		expect(screen()).toContain('Turned down.');
	});
});
