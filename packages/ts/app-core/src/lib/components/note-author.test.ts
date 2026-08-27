import type { ProfileView } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DID, useFakeApi, type FakeApi } from '../stores/fake-api.test-support.js';
import { people } from '../stores/people.svelte.js';
import NoteAuthor from './note-author.svelte';

const PEER = 'did:syr:z6MkjChhrJfLm9WGVUAnyLPnfPGmZDcyDKNsBTsAsn7RkAqB';

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

function show(did: string): void {
	mounted = mount(NoteAuthor, { target, props: { did } });
	flushSync();
}

beforeEach(() => {
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
	});
	people.hold(null);
	api = useFakeApi();
	api.on(asked(PEER), () => THEM);
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

	it('says nothing at all about an author nobody here can resolve', async () => {
		show('did:syr:z6MkfZ3Uc1nUxUeaKvcVjNbBidsWv5tvfAv1TFuxNvcbXeaC');
		await settle();
		expect(target.textContent).toBe('');
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
