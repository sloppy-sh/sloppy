import type { Address, OwnedRef, Tag } from '@sloppy/types';
import { describe, expect, it } from 'vitest';
import { RUN_PAGE, TOP, type TreeNote, type TreeRow, walkTree } from './walk.js';

const DID = 'did:syr:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';

const held = (address: string): OwnedRef => `${DID}/${address}` as OwnedRef;

/** `1` → `a`, `26` → `z`, `27` → `aa`, the way a letter segment counts. */
function letters(ordinal: number): string {
	let out = '';
	let left = ordinal;
	while (left > 0) {
		const step = (left - 1) % 26;
		out = String.fromCharCode(97 + step) + out;
		left = Math.floor((left - 1) / 26);
	}
	return out;
}

function note(address: string, parent?: string, over: Partial<TreeNote> = {}): TreeNote {
	return {
		ref: held(address),
		address: address as Address,
		parent: parent === undefined ? undefined : held(parent),
		title: address,
		tags: [],
		...over
	};
}

const addresses = (rows: readonly TreeRow[]): string[] =>
	rows.map((row) => (row.kind === 'note' ? row.note.address : `+${row.rest}`));

const opened = (...of: string[]) => new Set(of.map(held));

/** One note with a long run of children under it. */
function wide(children: number): TreeNote[] {
	return [
		note('1'),
		...Array.from({ length: children }, (_, at) => note(`1${letters(at + 1)}`, '1'))
	];
}

describe('the shape a tree walks', () => {
	it('draws a note before the notes under it, and only once it is opened', () => {
		const notes = [note('1'), note('1a', '1'), note('1a1', '1a'), note('2')];
		expect(addresses(walkTree({ notes, opened: opened() }))).toEqual(['1', '2']);
		expect(addresses(walkTree({ notes, opened: opened('1') }))).toEqual(['1', '1a', '2']);
		expect(addresses(walkTree({ notes, opened: opened('1', '1a') }))).toEqual([
			'1',
			'1a',
			'1a1',
			'2'
		]);
	});

	it('puts a run in address order however it arrived', () => {
		const notes = [note('1c', '1'), note('1a', '1'), note('1b', '1'), note('1')];
		expect(addresses(walkTree({ notes, opened: opened('1') }))).toEqual(['1', '1a', '1b', '1c']);
	});

	it('counts the notes under one, however deep', () => {
		const rows = walkTree({
			notes: [
				note('1'),
				note('1a', '1'),
				note('1a1', '1a'),
				note('1a1a', '1a1'),
				note('1b', '1'),
				note('2')
			],
			opened: opened('1')
		});
		expect(rows.find((row) => row.kind === 'note' && row.note.address === '1')).toMatchObject({
			under: 4,
			children: 2
		});
		expect(rows.find((row) => row.kind === 'note' && row.note.address === '1a')).toMatchObject({
			under: 2,
			children: 1
		});
	});

	it('says where each note sits along its run', () => {
		const rows = walkTree({
			notes: [note('1'), note('1a', '1'), note('1b', '1'), note('1c', '1')],
			opened: opened('1')
		});
		expect(
			rows.filter((row) => row.kind === 'note').map((row) => [row.note.address, row.at, row.of])
		).toEqual([
			['1', 1, 1],
			['1a', 1, 3],
			['1b', 2, 3],
			['1c', 3, 3]
		]);
	});

	it('starts a run at a note whose parent it was not given', () => {
		const rows = walkTree({ notes: [note('1a', '1'), note('1a1', '1a')], opened: opened('1a') });
		expect(addresses(rows)).toEqual(['1a', '1a1']);
		expect(rows[0]).toMatchObject({ depth: 0 });
		expect(rows[1]).toMatchObject({ depth: 1 });
	});

	it('never branches on the notes a note names', () => {
		// `references` and `links` ride along on a NodeView and are no part of the
		// walk.
		const cited = note('9');
		const citing = { ...note('1'), references: [cited.ref], links: [cited.ref] };
		const rows = walkTree({ notes: [citing, cited], opened: opened('1', '9') });
		expect(addresses(rows)).toEqual(['1', '9']);
		expect(rows.every((row) => row.depth === 0)).toBe(true);
		expect(rows.every((row) => row.kind === 'note' && row.children === 0)).toBe(true);
	});

	it('hands the surface the tags a note carries, untouched', () => {
		const rows = walkTree({
			notes: [note('1', undefined, { tags: ['seed'] as Tag[] })],
			opened: opened()
		});
		expect(rows[0].kind === 'note' && rows[0].note.tags).toEqual(['seed']);
	});
});

describe('a run longer than a page', () => {
	const notes = wide(250);

	it('stops at the page and says how many are waiting', () => {
		const rows = walkTree({ notes, opened: opened('1') });
		expect(rows.filter((row) => row.kind === 'note')).toHaveLength(1 + RUN_PAGE);
		expect(rows.at(-1)).toMatchObject({
			kind: 'rest',
			key: held('1'),
			parent: '1',
			depth: 1,
			rest: 250 - RUN_PAGE,
			drawn: RUN_PAGE
		});
	});

	// A reader on note 200 of a run must not have to press "show more" to find
	// the row they are standing on.
	it('reaches the note being read, however far along the run it sits', () => {
		const far = notes.find((one) => one.address === `1${letters(200)}`);
		if (!far) throw new Error('the corpus has no 200th note');
		const rows = walkTree({ notes, opened: opened('1'), reading: far.ref });

		const drawn = rows.filter((row) => row.kind === 'note');
		expect(drawn.some((row) => row.kind === 'note' && row.note.ref === far.ref)).toBe(true);
		expect(drawn).toHaveLength(1 + 200);
		expect(rows.at(-1)).toMatchObject({ kind: 'rest', rest: 50, drawn: 200 });
	});

	it('draws the next page once it has been asked for, and no more', () => {
		const shown = new Map([[held('1'), RUN_PAGE * 2]]);
		const rows = walkTree({ notes, opened: opened('1'), shown });
		expect(rows.filter((row) => row.kind === 'note')).toHaveLength(1 + RUN_PAGE * 2);
		expect(rows.at(-1)).toMatchObject({ kind: 'rest', rest: 250 - RUN_PAGE * 2 });
	});

	it('leaves no tail behind once the whole run is drawn', () => {
		const rows = walkTree({ notes, opened: opened('1'), shown: new Map([[held('1'), 250]]) });
		expect(rows.every((row) => row.kind === 'note')).toBe(true);
		expect(rows).toHaveLength(251);
	});

	it('pages the notes with nothing above them the same way', () => {
		const roots = Array.from({ length: 150 }, (_, at) => note(`${at + 1}`));
		const rows = walkTree({ notes: roots, opened: opened() });
		expect(rows.filter((row) => row.kind === 'note')).toHaveLength(RUN_PAGE);
		expect(rows.at(-1)).toMatchObject({ kind: 'rest', key: TOP, parent: null, depth: 0, rest: 50 });
	});
});

describe('a graph of a few thousand notes', () => {
	/** Wide and shallow, which is the shape a Zettelkasten grows into. */
	const notes = Array.from({ length: 40 }, (_, root) => `${root + 1}`).flatMap((root) => [
		note(root),
		...Array.from({ length: 80 }, (_, at) => note(`${root}${letters(at + 1)}`, root))
	]);

	it('draws only the notes with nothing above them until a branch is opened', () => {
		expect(notes.length).toBeGreaterThan(3_000);
		const rows = walkTree({ notes, opened: opened() });
		expect(rows.filter((row) => row.kind === 'note')).toHaveLength(40);
	});

	it('adds one branch when one branch is opened', () => {
		const rows = walkTree({ notes, opened: opened('1') });
		expect(rows.filter((row) => row.kind === 'note')).toHaveLength(40 + 80);
	});

	it('counts everything under a root without drawing any of it', () => {
		const rows = walkTree({ notes, opened: opened() });
		expect(rows[0]).toMatchObject({ under: 80, children: 80, open: false });
	});
});
