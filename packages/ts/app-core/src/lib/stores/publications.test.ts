// Which of somebody's own branches carries a note, answered off the genealogy
// in hand. A label neither says which notes a branch holds nor moves one, so
// every read here is about the notes a publication is rooted at and the parents
// between them.

import type { NodeView, PublicationView } from '@sloppy/types';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	AT,
	DID,
	node,
	ref,
	unnumbered,
	useFakeApi,
	VIEWER,
	type FakeApi
} from './fake-api.test-support.js';
import { nodes } from './nodes.svelte.js';
import { publications } from './publications.svelte.js';
import { session } from './session.svelte.js';

const ROOT = ref(1);
const MIDDLE = ref(2);
const LEAF = ref(3);
const ELSEWHERE = ref(4);

/** A branch its author published, rooted at one of their notes. */
function publication(over: Partial<PublicationView> = {}): PublicationView {
	return {
		ref: ref(50),
		created_by: DID,
		created_at: AT,
		updated_at: AT,
		root: ROOT,
		root_address: '1',
		comments: 'anyone',
		latest: { ref: ref(60), sequence: 1, published_at: AT },
		...over
	};
}

/** The branch these tests read: a root nobody numbered, a note under it that
 *  carries a number, and one under that which carries none — plus a note of
 *  another notebook, labelled the way a root is. */
const BRANCH = [
	unnumbered(1),
	node(2, '7', { origin: ROOT, parent: ROOT, depth: 2 }),
	unnumbered(3, { origin: ROOT, parent: MIDDLE, depth: 3 }),
	node(4, '1', { origin: ELSEWHERE, depth: 1 })
];

let api: FakeApi;

beforeEach(async () => {
	api = useFakeApi();
	nodes.clear();
	publications.clear();
	session.adopt(VIEWER, 'a-token');
	api.on('GET /nodes', () => BRANCH);
	await nodes.load();
});

/** One of the branch's notes, as a surface hands it over. */
function held(ref: string): NodeView {
	const note = nodes.get(ref as NodeView['ref']);
	if (!note) throw new Error(`${ref} is not in hand`);
	return note;
}

async function publishes(...rows: PublicationView[]): Promise<void> {
	api.on('GET /publications', () => rows);
	await publications.load();
}

describe('the branch a note is published in', () => {
	it('is the one rooted at that very note, whatever it is labelled', async () => {
		await publishes(publication({ root: ROOT, root_address: undefined }));

		expect(publications.at(held(ROOT))?.root).toBe(ROOT);
		// The `1` of another notebook is another note, and carries nothing here.
		expect(publications.at(held(ELSEWHERE))).toBeUndefined();
	});

	it('is the nearest one the note springs from, over notes nobody numbered', async () => {
		await publishes(
			publication({ ref: ref(50), root: ROOT, root_address: undefined }),
			publication({ ref: ref(51), root: MIDDLE, root_address: '7' })
		);

		expect(publications.above(held(LEAF))?.root).toBe(MIDDLE);
		expect(publications.above(held(MIDDLE))?.root).toBe(ROOT);
		expect(publications.above(held(ROOT))).toBeUndefined();
	});

	// Nothing between the two is published, so the walk has to run the whole way
	// up rather than stopping at the note's own parent.
	it('is one rooted two notes above it', async () => {
		await publishes(publication({ root: ROOT, root_address: undefined }));

		expect(publications.above(held(LEAF))?.root).toBe(ROOT);
		expect(publications.answersOn(held(LEAF))).toBe('anyone');
	});

	it('is not one rooted at a note this one does not spring from', async () => {
		await publishes(publication({ root: ELSEWHERE, root_address: '1' }));

		expect(publications.above(held(LEAF))).toBeUndefined();
	});
});

describe('what publishing a branch would carry', () => {
	it('names a narrower branch under it, reached over a note nobody numbered', async () => {
		await publishes(
			publication({
				ref: ref(51),
				root: LEAF,
				root_address: '7a',
				comments: 'nobody'
			})
		);

		expect(publications.narrowerUnder(held(ROOT), 'anyone').map((one) => one.root)).toEqual([LEAF]);
	});

	it('names one its author never numbered, which nothing else could cite', async () => {
		await publishes(
			publication({ ref: ref(51), root: LEAF, root_address: undefined, comments: 'nobody' })
		);

		expect(publications.narrowerUnder(held(ROOT), 'anyone').map((one) => one.root)).toEqual([LEAF]);
	});

	it('leaves out one rooted somewhere this branch does not reach', async () => {
		await publishes(publication({ root: ELSEWHERE, root_address: '1', comments: 'nobody' }));

		expect(publications.narrowerUnder(held(ROOT), 'anyone')).toEqual([]);
	});
});

describe('who may answer a note', () => {
	it('is the widest invitation of the branches that carry it', async () => {
		await publishes(
			publication({ ref: ref(50), root: ROOT, root_address: undefined }),
			publication({ ref: ref(51), root: MIDDLE, root_address: '7', comments: 'nobody' })
		);

		expect(publications.answersOn(held(LEAF))).toBe('anyone');
	});

	it('is nobody where every branch carrying it says so', async () => {
		await publishes(
			publication({ ref: ref(51), root: MIDDLE, root_address: '7', comments: 'nobody' })
		);

		expect(publications.answersOn(held(LEAF))).toBe('nobody');
		expect(publications.answersOn(held(ELSEWHERE))).toBeNull();
	});
});

describe('the order a person reads their branches in', () => {
	it('puts the ones carrying a number first, then the rest as they were published', async () => {
		await publishes(
			publication({
				ref: ref(52),
				root: LEAF,
				root_address: undefined,
				created_at: '2026-03-01T00:00:00.000Z'
			}),
			publication({
				ref: ref(53),
				root: ELSEWHERE,
				root_address: undefined,
				created_at: '2026-02-01T00:00:00.000Z'
			}),
			publication({ ref: ref(51), root: MIDDLE, root_address: '7' })
		);

		expect(publications.all.map((one) => one.ref)).toEqual([ref(51), ref(53), ref(52)]);
	});
});
