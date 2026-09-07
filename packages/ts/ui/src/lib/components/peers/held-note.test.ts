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

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

async function settle(): Promise<void> {
	for (let at = 0; at < 4; at++) {
		flushSync();
		await new Promise((done) => setTimeout(done, 0));
	}
	flushSync();
}

async function read(person: Person | null, unplaced = false): Promise<void> {
	mounted = mount(HeldNote, {
		target,
		props: {
			note: NOTE_VIEW,
			author: { identity: ADA, person, unplaced },
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
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	document.body.innerHTML = '';
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

	it('draws the letters they travel by once nobody could be placed there', async () => {
		await read(null, true);

		const text = document.body.textContent ?? '';
		expect(text).toContain('z6MkAdaA…aAda wrote this');
		expect(text).not.toContain(ADA);
	});
});
