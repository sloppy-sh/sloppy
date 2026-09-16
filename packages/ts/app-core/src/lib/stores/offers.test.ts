import type { BlockView, NodeView, OwnedRef } from '@sloppy/types';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	AT,
	DID,
	amendment,
	amending,
	node,
	ref,
	refuses,
	useFakeApi,
	VIEWER,
	type FakeApi
} from './fake-api.test-support.js';
import { nodes } from './nodes.svelte.js';
import { offers } from './offers.svelte.js';
import { session } from './session.svelte.js';

const KEEPER = 'did:syr:z6MkjChhrJfLm9WGVUAnyLPnfPGmZDcyDKNsBTsAsn7RkAqB';
const THEIRS: OwnedRef = ref(1, KEEPER);

/** `<did>/<ulid>` as the two path segments a route binds. */
function notePath(of: OwnedRef): string {
	const cut = of.lastIndexOf('/');
	return `/${encodeURIComponent(of.slice(0, cut))}/${encodeURIComponent(of.slice(cut + 1))}`;
}

function words(said: string) {
	return {
		type: 'doc' as const,
		content: [{ type: 'paragraph', content: [{ type: 'text', text: said }] }]
	};
}

function section(seed: number, said: string): BlockView {
	return {
		ref: ref(seed, KEEPER),
		created_by: KEEPER,
		node: THEIRS,
		ord: '000',
		content: words(said),
		created_at: AT,
		updated_at: AT
	};
}

const OPENING = section(10, 'The seed of the argument');

function theirNote(over: Partial<NodeView> = {}): NodeView {
	return { ...node(1, '1', { created_by: KEEPER, owner: KEEPER }), ref: THEIRS, ...over };
}

let api: FakeApi;

beforeEach(() => {
	api = useFakeApi();
	nodes.clear();
	offers.clear();
	session.clear();
	session.adopt(VIEWER, 'a-session');
});

describe('what is offered on a note', () => {
	it('answers none where the note takes no offers, and says nothing about it', async () => {
		api.on(`GET /nodes${notePath(THEIRS)}/amendments`, () =>
			refuses('This graph has one writer.', 403)
		);
		await offers.read(THEIRS);

		expect(offers.on(THEIRS)).toEqual([]);
		expect(offers.says).toBeNull();
		expect(offers.settled(THEIRS)).toBe(true);
	});

	it('picks this person’s own offer out of what is standing there', async () => {
		amending(
			api,
			{
				[THEIRS]: [
					amendment(50, THEIRS, KEEPER, { created_by: KEEPER }),
					amendment(51, THEIRS, DID, { created_by: KEEPER, message: 'A clearer opening' })
				]
			},
			() => theirNote()
		);
		await offers.read(THEIRS);

		expect(offers.on(THEIRS)).toHaveLength(2);
		expect(offers.mine(THEIRS)?.message).toBe('A clearer opening');
	});
});

describe('the writing offered from this device', () => {
	it('opens on the note as it stands, with nothing to offer yet', async () => {
		amending(api, { [THEIRS]: [] }, () => theirNote());
		await offers.read(THEIRS);
		offers.hold(THEIRS, { title: 'The opening', tags: ['seed'], blocks: [OPENING] });

		expect(offers.draft(THEIRS)?.title).toBe('The opening');
		expect(offers.changed(THEIRS)).toBe(false);
	});

	it('has something to offer once a section is written in', async () => {
		amending(api, { [THEIRS]: [] }, () => theirNote());
		await offers.read(THEIRS);
		offers.hold(THEIRS, { title: 'The opening', tags: [], blocks: [OPENING] });
		offers.writeSection(THEIRS, OPENING.ref, { content: words('Rewritten') });

		expect(offers.changed(THEIRS)).toBe(true);
		expect(offers.draft(THEIRS)?.blocks[0].content).toEqual(words('Rewritten'));
	});

	it('adds a section the note does not have, after the one it follows', async () => {
		amending(api, { [THEIRS]: [] }, () => theirNote());
		await offers.read(THEIRS);
		offers.hold(THEIRS, { title: '', tags: [], blocks: [OPENING] });
		const added = offers.addSection({ node: THEIRS, after: OPENING.ref });

		expect(offers.draft(THEIRS)?.blocks.map((one) => one.ref)).toEqual([OPENING.ref, added.ref]);
		expect(added.ref.startsWith(`${KEEPER}/`)).toBe(true);
	});

	it('takes a section out', async () => {
		amending(api, { [THEIRS]: [] }, () => theirNote());
		await offers.read(THEIRS);
		offers.hold(THEIRS, { title: '', tags: [], blocks: [OPENING] });
		offers.dropSection(THEIRS, OPENING.ref);

		expect(offers.draft(THEIRS)?.blocks).toEqual([]);
		expect(offers.changed(THEIRS)).toBe(true);
	});

	it('has nothing to offer once a title is typed and typed back', async () => {
		amending(api, { [THEIRS]: [] }, () => theirNote());
		await offers.read(THEIRS);
		offers.hold(THEIRS, { title: 'The opening', tags: [], blocks: [] });

		offers.retitle(THEIRS, 'Another opening');
		expect(offers.changed(THEIRS)).toBe(true);
		offers.retitle(THEIRS, 'The opening');
		expect(offers.changed(THEIRS)).toBe(false);
	});

	it('offers the whole of the note’s writing, and puts the draft away', async () => {
		amending(api, { [THEIRS]: [] }, () => theirNote());
		await offers.read(THEIRS);
		offers.hold(THEIRS, { title: 'The opening', tags: ['seed'], blocks: [OPENING] });
		offers.retitle(THEIRS, 'A clearer opening');

		const offered = await offers.propose(THEIRS, 'Reads better this way');

		expect(offered.title).toBe('A clearer opening');
		expect(offered.tags).toEqual(['seed']);
		expect(offered.blocks.map((one) => one.ref)).toEqual([OPENING.ref]);
		expect(offered.message).toBe('Reads better this way');
		expect(offers.mine(THEIRS)?.ref).toBe(offered.ref);
	});

	it('offers nothing said where nothing was said', async () => {
		amending(api, { [THEIRS]: [] }, () => theirNote());
		await offers.read(THEIRS);
		offers.hold(THEIRS, { title: 'The opening', tags: [], blocks: [OPENING] });
		offers.retitle(THEIRS, 'A clearer opening');

		const offered = await offers.propose(THEIRS, '   ');
		expect(offered.message).toBeUndefined();
	});

	// One offer per person per note: what comes back is the standing offer rather
	// than the note, so writing again edits what was offered.
	it('opens again on the offer already standing there', async () => {
		amending(
			api,
			{
				[THEIRS]: [amendment(60, THEIRS, DID, { created_by: KEEPER, title: 'As I would have it' })]
			},
			() => theirNote()
		);
		await offers.read(THEIRS);
		offers.hold(THEIRS, { title: 'The opening', tags: [], blocks: [OPENING] });

		expect(offers.draft(THEIRS)?.title).toBe('As I would have it');
		expect(offers.changed(THEIRS)).toBe(false);
	});

	it('is gone once it is taken back', async () => {
		const standing = amendment(61, THEIRS, DID, { created_by: KEEPER });
		amending(api, { [THEIRS]: [standing] }, () => theirNote());
		await offers.read(THEIRS);
		offers.hold(THEIRS, { title: 'The opening', tags: [], blocks: [OPENING] });

		await offers.withdraw(standing);

		expect(offers.mine(THEIRS)).toBeUndefined();
		expect(offers.draft(THEIRS)).toBeUndefined();
	});
});

describe('settling an offer', () => {
	it('takes one in and hands back the note the offer’s writing left', async () => {
		const standing = amendment(70, THEIRS, DID, { created_by: KEEPER, title: 'A clearer opening' });
		amending(api, { [THEIRS]: [standing] }, () =>
			theirNote({ title: 'A clearer opening', contributors: [DID] })
		);
		api.on(`GET /nodes${notePath(THEIRS)}`, () =>
			theirNote({ title: 'A clearer opening', contributors: [DID] })
		);
		await offers.read(THEIRS);

		const settled = await offers.approve(standing);

		expect(settled.title).toBe('A clearer opening');
		expect(offers.on(THEIRS)).toEqual([]);
		expect(nodes.get(THEIRS)?.contributors).toEqual([DID]);
	});

	it('turns one down and keeps nothing of it', async () => {
		const standing = amendment(71, THEIRS, DID, { created_by: KEEPER });
		amending(api, { [THEIRS]: [standing] }, () => theirNote());
		await offers.read(THEIRS);

		await offers.decline(standing);

		expect(offers.on(THEIRS)).toEqual([]);
	});

	it('says what it was told when an act will not go through', async () => {
		const standing = amendment(72, THEIRS, DID, { created_by: KEEPER });
		amending(api, { [THEIRS]: [standing] }, () => refuses('That note has moved on.', 409));
		await offers.read(THEIRS);

		await expect(offers.approve(standing)).rejects.toThrow();

		expect(offers.says).toBe('That note has moved on.');
		expect(offers.on(THEIRS).map((one) => one.ref)).toEqual([standing.ref]);
	});
});
