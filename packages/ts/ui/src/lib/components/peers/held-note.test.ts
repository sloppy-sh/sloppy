// @vitest-environment jsdom
import type { NodeView, OwnedRef, Timestamp } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import type { Person } from '../identity/person.js';
import HeldNote from './held-note.svelte';

const ADA = 'did:syr:z6MkAdaAdaAdaAdaAdaAdaAdaAdaAdaAda';
const NOTE = `${ADA}/01ARZ3NDEKTSV4RRFFQ69G5FAV` as OwnedRef;

const ADA_PERSON: Person = {
	identity: ADA,
	displayName: 'Ada Lovelace',
	handle: 'ada',
	bio: null,
	avatar: null,
	banner: null
};

const NOTE_VIEW: NodeView = {
	ref: NOTE,
	created_by: ADA,
	created_at: '2026-01-01T00:00:00.000Z' as Timestamp,
	updated_at: '2026-01-01T00:00:00.000Z' as Timestamp,
	address: '1a',
	depth: 2,
	origin: `${ADA}/01ARZ3NDEKTSV4RRFFQ69G5FA0` as OwnedRef,
	title: 'What a run of thought is for',
	tags: [],
	links: [],
	published: true
};

/** The same note as its author left it: no address, and so a root's depth. */
function unnumbered(): NodeView {
	const note: NodeView = { ...NOTE_VIEW, depth: 1 };
	delete note.address;
	return note;
}

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

async function settle(): Promise<void> {
	for (let at = 0; at < 4; at++) {
		flushSync();
		await new Promise((done) => setTimeout(done, 0));
	}
	flushSync();
}

const citation = () =>
	document.body.querySelector<HTMLButtonElement>('button[aria-label="Copy this note\'s address"]');

const linkControl = () =>
	document.body.querySelector<HTMLButtonElement>('button[aria-label="Copy a link to this note"]');

const LINK = 'https://sloppy.example/n/did:syr:z6MkAda/01ARZ3NDEKTSV4RRFFQ69G5FAV';

/** What the surface handed the clipboard, in the order it was handed over. */
let copied: string[];
let restoreClipboard: (() => void) | undefined;

function clipboardKeeps(): void {
	const board = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard');
	Object.defineProperty(globalThis.navigator, 'clipboard', {
		configurable: true,
		value: { writeText: (text: string) => (copied.push(text), Promise.resolve()) }
	});
	restoreClipboard = () => {
		if (board) Object.defineProperty(globalThis.navigator, 'clipboard', board);
		else delete (globalThis.navigator as { clipboard?: unknown }).clipboard;
	};
}

async function read(
	person: Person | null,
	unplaced = false,
	note: NodeView = NOTE_VIEW,
	over: { notebook?: string; link?: string } = {}
): Promise<void> {
	mounted = mount(HeldNote, {
		target,
		props: {
			note,
			author: { identity: ADA, person, unplaced },
			...over,
			blocks: [],
			pictures: { picture: () => Promise.reject(new Error('no pictures here')) },
			references: { read: () => Promise.resolve(null), open: () => {} },
			emoji: () => Promise.resolve([]),
			onClose: () => {}
		}
	});
	await settle();
}

beforeEach(() => {
	stubMediaQuery((query) => query.includes('min-width'));
	stubResizeObserver();
	copied = [];
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	restoreClipboard?.();
	restoreClipboard = undefined;
	document.body.innerHTML = '';
});

describe('the address on a note somebody else wrote', () => {
	it('is there to copy', async () => {
		await read(ADA_PERSON);
		expect(citation()).not.toBeNull();
	});

	it('is nowhere to be copied where its author gave it none', async () => {
		await read(ADA_PERSON, false, unnumbered());

		expect(citation()).toBeNull();
		expect(document.body.textContent).toContain('What a run of thought is for');
	});

	it('goes to the clipboard with the notebook it is read in', async () => {
		clipboardKeeps();
		await read(ADA_PERSON, false, NOTE_VIEW, { notebook: 'The thesis' });

		citation()?.click();
		await settle();

		expect(copied).toEqual(['1a · The thesis']);
	});
});

describe('a note somebody else wrote with no address', () => {
	it('offers a link instead, and hands that over', async () => {
		clipboardKeeps();
		await read(ADA_PERSON, false, unnumbered(), { link: LINK });

		expect(document.body.textContent).toContain('Copy link');
		linkControl()?.click();
		await settle();

		expect(copied).toEqual([LINK]);
	});

	it('offers nothing to copy where the surface knows of no link', async () => {
		await read(ADA_PERSON, false, unnumbered());

		expect(linkControl()).toBeNull();
		expect(citation()).toBeNull();
	});

	it('keeps the link out of the way of a note that has an address', async () => {
		await read(ADA_PERSON, false, NOTE_VIEW, { link: LINK });

		expect(linkControl()).toBeNull();
		expect(citation()).not.toBeNull();
	});
});

describe('the byline on a note somebody else wrote', () => {
	it('names its author', async () => {
		await read(ADA_PERSON);
		expect(document.body.textContent).toContain('Ada Lovelace wrote this');
	});

	it('says Somebody while their name is still on its way', async () => {
		await read(null);

		const text = document.body.textContent ?? '';
		expect(text).toContain('Somebody wrote this');
		expect(text).not.toContain(ADA);
	});

	it('calls them Somebody, and never a piece of their identity, once nobody could place them', async () => {
		await read(null, true);

		const text = document.body.textContent ?? '';
		expect(text).toContain('Somebody wrote this');
		expect(text).not.toContain('z6Mk');
	});
});
