import type { BlockView, OwnedRef } from '@sloppy/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AT, DID, type FakeApi, ref, useFakeApi } from './fake-api.test-support.js';
import { outlineSections } from './outline-sections.svelte.js';

const NOTE = ref(100);
const S1 = ref(101);
const S2 = ref(102);
const S3 = ref(103);

const PATH = `/nodes/${encodeURIComponent(DID)}/${encodeURIComponent(NOTE.split('/')[1])}/blocks`;
const blockPath = (of: OwnedRef) =>
	`/blocks/${encodeURIComponent(DID)}/${encodeURIComponent(of.split('/')[1])}`;

function block(of: OwnedRef, ord: string, content: BlockView['content']): BlockView {
	return {
		ref: of,
		created_by: DID,
		created_at: AT,
		updated_at: `2026-01-0${ord}T00:00:00.000Z`,
		node: NOTE,
		ord,
		content
	};
}

const words = (line: string) => ({
	type: 'doc' as const,
	content: [{ type: 'paragraph', content: [{ type: 'text', text: line }] }]
});

const STACK = [
	block(S1, '1', words('The first thing')),
	block(S2, '2', { type: 'doc', content: [{ type: 'ink', attrs: { strokes: [] } }] }),
	block(S3, '3', words('The last thing'))
];

let api: FakeApi;
/** What the reorder route was asked for, in order. */
let asked: { ref: OwnedRef; body: unknown }[];

beforeEach(() => {
	outlineSections.clear();
	api = useFakeApi();
	asked = [];
	api.on(`GET ${PATH}`, () => STACK);
	for (const one of STACK) {
		api.on(`PATCH ${blockPath(one.ref)}`, (_url, init) => {
			asked.push({ ref: one.ref, body: JSON.parse(String(init?.body ?? '{}')) });
			return { ...one, updated_at: '2026-02-02T00:00:00.000Z' };
		});
	}
});

afterEach(() => {
	outlineSections.clear();
});

/** Let whatever the store has in the air land. */
const settle = () => new Promise((done) => setTimeout(done, 0));

describe('a note’s sections in the outline', () => {
	it('reads the stack when the note is opened, and says each section’s first line', async () => {
		outlineSections.show(NOTE, true);
		await settle();
		expect(outlineSections.of(NOTE)?.map((one) => one.says)).toEqual([
			'The first thing',
			'A drawing',
			'The last thing'
		]);
		expect(outlineSections.says(NOTE).says).toBe('');
	});

	it('says it is reading before the stack is in hand', () => {
		outlineSections.show(NOTE, true);
		expect(outlineSections.of(NOTE)).toBeUndefined();
		expect(outlineSections.says(NOTE).says).toBe('Reading this note…');
	});

	it('draws what it holds at once and reads the note again behind it', async () => {
		outlineSections.show(NOTE, true);
		await settle();
		expect(outlineSections.shown.has(NOTE)).toBe(true);

		outlineSections.show(NOTE, false);
		expect(outlineSections.shown.has(NOTE)).toBe(false);

		api.on(`GET ${PATH}`, () => [STACK[0], STACK[2]]);
		outlineSections.show(NOTE, true);
		expect(outlineSections.of(NOTE)).toHaveLength(3);
		expect(outlineSections.says(NOTE).says).toBe('');

		await settle();
		expect(api.countOf(`GET ${PATH}`)).toBe(2);
		expect(outlineSections.of(NOTE)?.map((one) => one.says)).toEqual([
			'The first thing',
			'The last thing'
		]);
	});

	it('says a note with nothing written in it', async () => {
		api.on(`GET ${PATH}`, () => []);
		outlineSections.show(NOTE, true);
		await settle();
		expect(outlineSections.says(NOTE)).toEqual({
			says: 'Nothing is written in this note yet',
			again: false
		});
	});

	it('says what to do next when the stack will not read, and asks again on the next look', async () => {
		api.on(
			`GET ${PATH}`,
			() => new Response('{"message":"Internal server error"}', { status: 500 })
		);
		outlineSections.show(NOTE, true);
		await settle();
		expect(outlineSections.says(NOTE)).toEqual({
			says: 'These sections could not be read. Tap to try again.',
			again: true
		});

		api.on(`GET ${PATH}`, () => STACK);
		outlineSections.show(NOTE, true);
		await settle();
		expect(outlineSections.of(NOTE)).toHaveLength(3);
		expect(outlineSections.says(NOTE).says).toBe('');
	});

	it('passes the server’s own words through where it gave any', async () => {
		api.on(
			`GET ${PATH}`,
			() => new Response('{"message":"This note is not yours."}', { status: 403 })
		);
		outlineSections.show(NOTE, true);
		await settle();
		expect(outlineSections.says(NOTE).says).toBe('This note is not yours.');
	});
});

describe('arranging a note’s sections', () => {
	it('moves one within the note and asks the server to keep it there', async () => {
		outlineSections.show(NOTE, true);
		await settle();

		outlineSections.move(NOTE, S3, null);
		expect(outlineSections.of(NOTE)?.map((one) => one.ref)).toEqual([S3, S1, S2]);
		await settle();
		expect(asked).toEqual([{ ref: S3, body: { after: null } }]);
	});

	// Nothing about a move is conditioned on what the section last said, so a
	// second nudge before the first has landed is a second move, not a refusal.
	it('lands both of two nudges in a row', async () => {
		outlineSections.show(NOTE, true);
		await settle();

		outlineSections.move(NOTE, S3, S1);
		outlineSections.move(NOTE, S3, null);
		await settle();

		expect(outlineSections.of(NOTE)?.map((one) => one.ref)).toEqual([S3, S1, S2]);
		expect(outlineSections.says(NOTE).says).toBe('');
		expect(asked).toEqual([
			{ ref: S3, body: { after: S1 } },
			{ ref: S3, body: { after: null } }
		]);
	});

	it('names the section a moved one follows', async () => {
		outlineSections.show(NOTE, true);
		await settle();

		outlineSections.move(NOTE, S1, S2);
		expect(outlineSections.of(NOTE)?.map((one) => one.ref)).toEqual([S2, S1, S3]);
		await settle();
		expect(asked[0].body).toMatchObject({ after: S2 });
	});

	// The section was written somewhere else in between, so nothing moved and
	// the reader is told what to do about it.
	it('puts the stack back and says what to do when the move is refused', async () => {
		outlineSections.show(NOTE, true);
		await settle();

		api.on(
			`PATCH ${blockPath(S3)}`,
			() => new Response('{"message":"This section was written somewhere else."}', { status: 409 })
		);
		outlineSections.move(NOTE, S3, null);
		await settle();

		expect(outlineSections.of(NOTE)?.map((one) => one.ref)).toEqual([S1, S2, S3]);
		expect(outlineSections.says(NOTE).says).toBe('This section was written somewhere else.');
	});

	it('moves nothing for a note whose stack is not in hand', () => {
		outlineSections.move(NOTE, S1, null);
		expect(asked).toEqual([]);
	});

	it('holds nothing of one person’s outline for the next', async () => {
		outlineSections.mine(DID);
		outlineSections.show(NOTE, true);
		await settle();

		outlineSections.mine('did:syr:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH');
		expect(outlineSections.of(NOTE)).toBeUndefined();
		expect(outlineSections.shown.has(NOTE)).toBe(false);
	});
});
