import type { ProfileView, PublishedPublication } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AT, DID, ref, useFakeApi, VIEWER, type FakeApi } from '../stores/fake-api.test-support.js';
import { peers } from '../stores/peers.svelte.js';
import { people } from '../stores/people.svelte.js';
import { session } from '../stores/session.svelte.js';
import NoteAuthor from './note-author.svelte';

const PEER = 'did:syr:z6MkjChhrJfLm9WGVUAnyLPnfPGmZDcyDKNsBTsAsn7RkAqB';
const STRANGER = 'did:syr:z6MkfZ3Uc1nUxUeaKvcVjNbBidsWv5tvfAv1TFuxNvcbXeaC';
const THIRD = 'did:syr:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';

const THEIR_BRANCH: PublishedPublication = {
	ref: ref(3, PEER),
	root_address: '1a',
	title: 'The seed of the argument',
	latest: { ref: ref(4, PEER), sequence: 1, published_at: AT }
};

/** As it reaches the server: an address is one path segment, colons and all. */
const asked = (did: string) => `GET /profile/${encodeURIComponent(did)}`;

const THEM: ProfileView = {
	did: PEER,
	username: 'charles',
	display_name: 'Charles Babbage',
	bio: null,
	avatar_src: null,
	banner_src: null
};

let api: FakeApi;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

async function settle(): Promise<void> {
	for (let turn = 0; turn < 3; turn += 1) {
		await new Promise((done) => setTimeout(done, 0));
		flushSync();
	}
}

function show(did: string, over: { authors?: string[]; contributors?: string[] } = {}): void {
	mounted = mount(NoteAuthor, { target, props: { note: { created_by: did, ...over } } });
	flushSync();
}

beforeEach(() => {
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: (query: string) => ({
			matches: query.includes('min-width'),
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
	people.hold(null);
	peers.clear();
	session.clear();
	session.adopt(VIEWER, 'a-session');
	api = useFakeApi();
	api.on(asked(PEER), () => THEM);
	api.on('GET /following', () => []);
	api.on('GET /pulls', () => []);
	api.on('GET /peers/publications', () => ({ did: PEER, publications: [THEIR_BRANCH] }));
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.body.innerHTML = '';
});

describe('who wrote the note', () => {
	it('names them, and stands their initials in until a picture is there', async () => {
		show(PEER);
		await settle();
		expect(target.textContent).toContain('Charles Babbage');
		expect(target.textContent).toContain('CB');
	});

	it('draws an author nobody here can place as the identifier they travel by', async () => {
		show(STRANGER);
		await settle();
		expect(target.textContent).toContain('z6MkfZ3U');
	});

	it('opens what they publish, and the way to follow them', async () => {
		show(PEER);
		await settle();
		target.querySelector('button')?.click();
		await settle();

		const text = document.body.textContent ?? '';
		expect(text).toContain('Charles Babbage');
		expect(text).toContain(PEER);
		expect(text).toContain('1a');
		expect(text).toContain('The seed of the argument');
		expect(text).toContain('Follow');
	});

	// The instance to ask is only known once the reader's follows are in, and
	// this instance answers nothing about a stranger it has never held.
	it('asks the instance they were followed from, not this one', async () => {
		api.on('GET /following', () => [{ did: PEER, provider_url: 'https://elsewhere.test' }]);
		show(PEER);
		await settle();
		target.querySelector('button')?.click();
		await settle();

		const asking = api.calls.find((call) => call.startsWith('GET /peers/publications'));
		expect(asking).toBeDefined();
		expect(new URL(asking!, 'http://api.test').searchParams.get('source_url')).toBe(
			'https://elsewhere.test'
		);
	});

	it('says nobody at all until their instance has answered', async () => {
		let answer!: (profile: ProfileView) => void;
		api.on(asked(PEER), () => new Promise<ProfileView>((done) => (answer = done)));
		show(PEER);
		await settle();
		expect(target.textContent).toBe('');

		answer(THEM);
		await settle();
		expect(target.textContent).toContain('Charles Babbage');
	});

	it('leaves the signed-in person’s own line alone', async () => {
		api.on('GET /profile/me', () => ({
			did: DID,
			username: 'ada',
			display_name: 'Ada Lovelace',
			bio: null,
			avatar_src: null,
			banner_src: null
		}));
		await people.read();
		show(DID);
		await settle();
		expect(target.querySelector('button')).toBeNull();
	});

	// The note surface is where a graph is read, so the same author over and over
	// is one question, not one per note.
	it('asks for an author once, however many notes of theirs are opened', async () => {
		show(PEER);
		await settle();
		unmount(mounted!, { outro: false });
		mounted = undefined;
		show(PEER);
		await settle();
		expect(api.countOf(asked(PEER))).toBe(1);
	});

	it('names one author plainly, without announcing the authorship', async () => {
		show(PEER);
		await settle();
		expect(target.textContent).not.toContain('Written by');
	});

	it('says whose writing a note carries where more than one person wrote it', async () => {
		api.on(asked(STRANGER), () => ({
			did: STRANGER,
			username: 'grace',
			display_name: 'Grace Hopper',
			bio: null,
			avatar_src: null,
			banner_src: null
		}));
		show(PEER, { authors: [PEER, STRANGER] });
		await settle();
		expect(target.textContent).toContain('Written by');
		expect(target.textContent).toContain('Charles Babbage');
		expect(target.textContent).toContain('Grace Hopper');
		expect(target.textContent).not.toContain('with');
	});

	it('names whoever contributed after whoever wrote it', async () => {
		api.on(asked(STRANGER), () => ({
			did: STRANGER,
			username: 'grace',
			display_name: 'Grace Hopper',
			bio: null,
			avatar_src: null,
			banner_src: null
		}));
		show(PEER, { contributors: [STRANGER] });
		await settle();
		expect(target.textContent).toContain('Written by');
		expect(target.textContent).toContain('Charles Babbage');
		expect(target.textContent).toContain('· with');
		expect(target.textContent).toContain('Grace Hopper');
	});

	// At phone width the line wraps between whoever wrote the note and whoever
	// helped, and a line that opens with a separator reads as a mistake.
	it('keeps the separator with the name it follows, so it never leads a line', async () => {
		api.on(asked(STRANGER), () => ({
			did: STRANGER,
			username: 'grace',
			display_name: 'Grace Hopper',
			bio: null,
			avatar_src: null,
			banner_src: null
		}));
		show(PEER, { contributors: [STRANGER] });
		await settle();

		const line = target.querySelector('div');
		if (!line) throw new Error('Nobody is named on screen');
		const said = [...line.children].map((one) => one.textContent?.trim() ?? '');
		expect(said).toContain('with');
		expect(said.some((one) => one.startsWith('·'))).toBe(false);
		expect(said.some((one) => one.endsWith('·'))).toBe(true);
	});

	// Three people on one line is where it wraps between two of them.
	it('keeps every separator with the name it follows, however many wrote it', async () => {
		api.on(asked(STRANGER), () => ({
			did: STRANGER,
			username: 'grace',
			display_name: 'Grace Hopper',
			bio: null,
			avatar_src: null,
			banner_src: null
		}));
		api.on(asked(THIRD), () => ({
			did: THIRD,
			username: 'alan',
			display_name: 'Alan Turing',
			bio: null,
			avatar_src: null,
			banner_src: null
		}));
		show(PEER, { authors: [PEER, STRANGER, THIRD] });
		await settle();

		const line = target.querySelector('div');
		if (!line) throw new Error('Nobody is named on screen');
		const said = [...line.children].map((one) => one.textContent?.trim() ?? '');
		expect(said.join(' ')).toContain('Alan Turing');
		expect(said.some((one) => one.startsWith('·'))).toBe(false);
		expect(said.some((one) => one.startsWith('and'))).toBe(false);
		expect(said.some((one) => one.endsWith('·'))).toBe(true);
		expect(said.some((one) => one.endsWith('and'))).toBe(true);
	});

	// `authors` absent, and empty, are the ref's DID alone — nothing else may
	// spell that fallback.
	it('reads an empty list of authors as whoever the note is filed under', async () => {
		show(PEER, { authors: [] });
		await settle();
		expect(target.textContent).toContain('Charles Babbage');
		expect(target.textContent).not.toContain('Written by');
	});

	it('names the signed-in person without asking a second time', async () => {
		api.on('GET /profile/me', () => ({
			did: DID,
			username: 'ada',
			display_name: 'Ada Lovelace',
			bio: null,
			avatar_src: null,
			banner_src: null
		}));
		await people.read();
		show(DID);
		await settle();
		expect(target.textContent).toContain('Ada Lovelace');
		expect(api.countOf(asked(DID))).toBe(0);
	});
});
