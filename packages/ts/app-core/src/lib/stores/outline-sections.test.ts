import type { BlockView, OwnedRef } from '@sloppy/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { arranging, AT, DID, type FakeApi, ref, useFakeApi } from './fake-api.test-support.js';
import { outlineSections } from './outline-sections.svelte.js';

const NOTE = ref(100);
const S1 = ref(101);
const S2 = ref(102);
const S3 = ref(103);
const OTHER = ref(200);
const O1 = ref(201);
const O2 = ref(202);
const ELSEWHERE = ref(300);

const PATH = `/nodes/${encodeURIComponent(DID)}/${encodeURIComponent(NOTE.split('/')[1])}/blocks`;
const blockPath = (of: OwnedRef) =>
	`/blocks/${encodeURIComponent(DID)}/${encodeURIComponent(of.split('/')[1])}`;

function block(
	of: OwnedRef,
	ord: string,
	content: BlockView['content'],
	inNote: OwnedRef = NOTE
): BlockView {
	return {
		ref: of,
		created_by: DID,
		created_at: AT,
		updated_at: `2026-01-0${ord}T00:00:00.000Z`,
		node: inNote,
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

const OTHER_STACK = [
	block(O1, '1', words('Something else'), OTHER),
	block(O2, '2', words('And after it'), OTHER)
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

	// The reader moved it while the note was being read again behind the rows, so
	// the listing that lands is older than what they have just done.
	it('keeps a move made while the note is being read again', async () => {
		outlineSections.show(NOTE, true);
		await settle();

		outlineSections.show(NOTE, false);
		outlineSections.show(NOTE, true);
		outlineSections.move(NOTE, S3, null);
		expect(outlineSections.of(NOTE)?.map((one) => one.ref)).toEqual([S3, S1, S2]);

		await settle();
		expect(outlineSections.of(NOTE)?.map((one) => one.ref)).toEqual([S3, S1, S2]);
		expect(asked).toEqual([{ ref: S3, body: { after: null } }]);
	});

	it('keeps a move the note is still being asked to make when a listing lands', async () => {
		outlineSections.show(NOTE, true);
		await settle();

		outlineSections.move(NOTE, S3, null);
		outlineSections.show(NOTE, false);
		outlineSections.show(NOTE, true);
		await settle();

		expect(outlineSections.of(NOTE)?.map((one) => one.ref)).toEqual([S3, S1, S2]);
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

	// The second move landed, so what stands here after the first is refused is
	// the stack the note now holds rather than the one before either move.
	it('shows what the note holds when the first of two moves is refused', async () => {
		outlineSections.show(NOTE, true);
		await settle();

		let tries = 0;
		api.on(`PATCH ${blockPath(S3)}`, () => {
			tries += 1;
			return tries === 1
				? new Response('{"message":"This section was written somewhere else."}', { status: 409 })
				: { ...STACK[2], ord: '0' };
		});
		api.on(`GET ${PATH}`, () => [{ ...STACK[2], ord: '0' }, STACK[0], STACK[1]]);

		outlineSections.move(NOTE, S3, S1);
		outlineSections.move(NOTE, S3, null);
		await settle();

		expect(outlineSections.of(NOTE)?.map((one) => one.ref)).toEqual([S3, S1, S2]);
		expect(outlineSections.says(NOTE)).toEqual({
			says: 'This section was written somewhere else.',
			again: true
		});
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

describe('carrying a section into another note', () => {
	/** The stacks the server holds, as the writes leave them. */
	let stacks: Map<OwnedRef, BlockView[]>;

	beforeEach(async () => {
		stacks = arranging(api, { [NOTE]: STACK, [OTHER]: OTHER_STACK, [ELSEWHERE]: [] });
		outlineSections.show(NOTE, true);
		outlineSections.show(OTHER, true);
		await settle();
	});

	/** What the server holds for a note, in order. */
	const held = (note: OwnedRef) => stacks.get(note)?.map((one) => one.ref);

	it('takes it out of one stack and into the other at once', async () => {
		outlineSections.moveTo(S3, OTHER, O1);
		expect(outlineSections.of(NOTE)?.map((one) => one.ref)).toEqual([S1, S2]);
		expect(outlineSections.of(OTHER)?.map((one) => one.ref)).toEqual([O1, S3, O2]);

		await settle();
		expect(held(NOTE)).toEqual([S1, S2]);
		expect(held(OTHER)).toEqual([O1, S3, O2]);
		expect(outlineSections.says(OTHER).says).toBe('');
		expect(outlineSections.says(NOTE).says).toBe('');
	});

	it('lands it at the top of the note it arrives in', async () => {
		outlineSections.moveTo(S1, OTHER, null);
		expect(outlineSections.of(OTHER)?.map((one) => one.ref)).toEqual([S1, O1, O2]);

		await settle();
		expect(held(OTHER)).toEqual([S1, O1, O2]);
		expect(stacks.get(OTHER)?.[0].node).toBe(OTHER);
	});

	it('carries one into a note whose stack is not in hand', async () => {
		outlineSections.moveTo(S2, ELSEWHERE, null);
		expect(outlineSections.of(NOTE)?.map((one) => one.ref)).toEqual([S1, S3]);
		expect(outlineSections.of(ELSEWHERE)).toBeUndefined();

		await settle();
		outlineSections.show(ELSEWHERE, true);
		await settle();
		expect(outlineSections.of(ELSEWHERE)?.map((one) => one.says)).toEqual(['A drawing']);
	});

	it('moves it within its own note when that is the note it is carried to', async () => {
		outlineSections.moveTo(S3, NOTE, null);
		expect(outlineSections.of(NOTE)?.map((one) => one.ref)).toEqual([S3, S1, S2]);

		await settle();
		expect(held(NOTE)).toEqual([S3, S1, S2]);
	});

	// Both stacks were disturbed, so both are read again and both say so.
	it('puts both stacks back and says what to do when the write is refused', async () => {
		api.on(
			`PATCH ${blockPath(S3)}`,
			() => new Response('{"message":"This section was written somewhere else."}', { status: 409 })
		);
		outlineSections.moveTo(S3, OTHER, null);
		await settle();

		expect(outlineSections.of(NOTE)?.map((one) => one.ref)).toEqual([S1, S2, S3]);
		expect(outlineSections.of(OTHER)?.map((one) => one.ref)).toEqual([O1, O2]);
		expect(outlineSections.says(NOTE).says).toBe('This section was written somewhere else.');
		expect(outlineSections.says(OTHER).says).toBe('This section was written somewhere else.');
	});

	it('carries nothing for a section no stack in hand holds', async () => {
		outlineSections.moveTo(ref(999), OTHER, null);
		await settle();
		expect(outlineSections.of(OTHER)?.map((one) => one.ref)).toEqual([O1, O2]);
		expect(held(OTHER)).toEqual([O1, O2]);
	});

	it('carries nothing where the section it is to follow is not in that note', async () => {
		outlineSections.moveTo(S3, OTHER, S1);
		await settle();
		expect(outlineSections.of(NOTE)?.map((one) => one.ref)).toEqual([S1, S2, S3]);
		expect(outlineSections.of(OTHER)?.map((one) => one.ref)).toEqual([O1, O2]);
	});

	it('holds a carry against a listing that was already in the air', async () => {
		outlineSections.show(OTHER, false);
		outlineSections.show(OTHER, true);
		outlineSections.moveTo(S3, OTHER, null);
		await settle();

		expect(outlineSections.of(OTHER)?.map((one) => one.ref)).toEqual([S3, O1, O2]);
		expect(outlineSections.of(NOTE)?.map((one) => one.ref)).toEqual([S1, S2]);
	});
});

// The outline draws a note's sections with the writing surface itself, so it
// asks for what each one holds and not only for the line it says.
describe('what the outline hands the writing surface', () => {
	let stacks: Map<OwnedRef, BlockView[]>;

	beforeEach(() => {
		stacks = arranging(api, { [NOTE]: STACK, [OTHER]: OTHER_STACK });
	});

	/** A section as the server holds it, which is what the next write of it has
	 *  to be made against. */
	const server = (note: OwnedRef, section: OwnedRef) =>
		stacks.get(note)?.find((one) => one.ref === section);

	it('holds nothing for a note nobody has opened', () => {
		expect(outlineSections.stack(NOTE)).toBeUndefined();
	});

	it('hands over the whole of every section, in stack order', async () => {
		outlineSections.show(NOTE, true);
		await settle();
		expect(outlineSections.stack(NOTE)).toEqual(STACK);
	});

	it('hands them over in the order an arrangement left them', async () => {
		outlineSections.show(NOTE, true);
		await settle();
		outlineSections.move(NOTE, S3, null);
		expect(outlineSections.stack(NOTE)?.map((one) => one.ref)).toEqual([S3, S1, S2]);
	});

	it('carries a section into the stack it was carried to', async () => {
		outlineSections.show(NOTE, true);
		outlineSections.show(OTHER, true);
		await settle();
		outlineSections.moveTo(S1, OTHER, O1);
		expect(outlineSections.stack(OTHER)?.map((one) => one.ref)).toEqual([O1, S1, O2]);
		expect(outlineSections.stack(NOTE)?.map((one) => one.ref)).toEqual([S2, S3]);
	});

	it('counts the arrangements a note has been asked for', async () => {
		outlineSections.show(NOTE, true);
		await settle();
		expect(outlineSections.arranged(NOTE)).toBe(0);

		outlineSections.move(NOTE, S3, null);
		expect(outlineSections.arranged(NOTE)).toBe(1);
		await settle();
		expect(outlineSections.arranged(NOTE)).toBe(1);
	});

	it('reads a note nobody is showing, for a carry that has to know its end', async () => {
		await outlineSections.read(OTHER);
		expect(outlineSections.of(OTHER)?.map((one) => one.ref)).toEqual([O1, O2]);
		expect(outlineSections.shown.has(OTHER)).toBe(false);
	});

	// A section is written in where it stands, and the writing surface makes its
	// write against the section as the last one left it.
	it('hands a carried section back as the carry left it', async () => {
		outlineSections.show(NOTE, true);
		outlineSections.show(OTHER, true);
		await settle();
		outlineSections.moveTo(S1, OTHER, O1);
		await settle();

		expect(outlineSections.stack(OTHER)?.find((one) => one.ref === S1)).toEqual(server(OTHER, S1));
	});

	it('hands a moved section back as the move left it', async () => {
		outlineSections.show(NOTE, true);
		await settle();
		outlineSections.move(NOTE, S3, null);
		await settle();

		expect(outlineSections.stack(NOTE)?.find((one) => one.ref === S3)).toEqual(server(NOTE, S3));
	});

	it('keeps nothing of one person’s reading for the next', async () => {
		outlineSections.show(NOTE, true);
		await settle();
		outlineSections.mine('did:syr:somebody-else');
		expect(outlineSections.stack(NOTE)).toBeUndefined();
	});
});
