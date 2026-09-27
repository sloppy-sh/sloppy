// What a draft reads as before anybody opens it, and one row per note once
// they have — DESIGN.md § "Reading a draft".

import type { ImportConflict, OwnedRef } from '@sloppy/types';
import { countsIn, type VaultDifference } from '@sloppy/vault';
import { describe, expect, it } from 'vitest';
import { draftHolds, draftRows, picturesSaid, type DraftNote } from './draft-said.js';

const DID = 'did:syr:z6MkhGzzHHg81JJpvVX8P6GFWcK6cyqveGpMfS1GYDFCDbx5';
const ref = (n: number) => `${DID}/01M3J000000000000000000${n}` as OwnedRef;

const ORIGINS = ref(1);
const PARSER = ref(2);
const VAULT = ref(3);

const named = new Map<OwnedRef, DraftNote>([
	[ORIGINS, { title: 'Origins', address: '1' }],
	[PARSER, { title: 'The parser', address: '1a' }],
	[VAULT, { title: 'The vault' }]
]);

function difference(over: Partial<VaultDifference['notes']> = {}): VaultDifference {
	return {
		notes: {
			added: [],
			removed: [],
			moved: [],
			retitled: [],
			renumbered: [],
			changed: [],
			...over
		},
		media: { added: [], removed: [] }
	};
}

const rows = (apart: VaultDifference, conflicts: readonly ImportConflict[] = []) =>
	draftRows(apart, conflicts, named);

describe('how much a draft holds', () => {
	it('says each thing that happened rather than one total', () => {
		const counts = countsIn(
			difference({
				added: [PARSER],
				changed: [
					{ ref: ORIGINS, sections: { added: [], removed: [], changed: ['a'], reordered: false } }
				],
				moved: [{ ref: VAULT, to: ORIGINS }]
			})
		);
		expect(draftHolds(counts)).toBe('1 new note, 1 written into, 1 moved');
	});

	it('says nothing at all about a draft nothing has happened in', () => {
		expect(draftHolds(countsIn(difference()))).toBe('');
	});

	it('leaves the pictures out where none arrived or went', () => {
		expect(picturesSaid(countsIn(difference()))).toBe(null);
		expect(
			picturesSaid({
				notes: { added: 0, removed: 0, moved: 0, retitled: 0, renumbered: 0, changed: 0 },
				media: { added: 2, removed: 1 }
			})
		).toBe('2 pictures arrived, 1 picture went.');
	});
});

describe('one row per note', () => {
	it('heads a row as somebody cites the note, by its number and its title', () => {
		expect(rows(difference({ added: [PARSER] }))[0].card.heading).toBe('1a · The parser');
		expect(rows(difference({ added: [VAULT] }))[0].card.heading).toBe('The vault');
	});

	it('says what a move was, by the notes at either end and not by their refs', () => {
		const held = rows(difference({ moved: [{ ref: VAULT, from: PARSER, to: ORIGINS }] }));
		expect(held[0].band).toBe('moved');
		expect(held[0].card.rows.map((row) => `${row.label}: ${row.value}`)).toEqual([
			'Under: 1 · Origins',
			'Was under: 1a · The parser'
		]);
	});

	it('says a note that opened a branch as being under nothing', () => {
		const held = rows(difference({ moved: [{ ref: VAULT, from: PARSER }] }));
		expect(held[0].card.rows.map((row) => `${row.label}: ${row.value}`)).toEqual([
			'Under: Nothing',
			'Was under: 1a · The parser'
		]);
	});

	it('says a number given up as the note having none', () => {
		const held = rows(difference({ renumbered: [{ ref: PARSER, from: '1a' }] }));
		expect(held[0].card.rows.map((row) => `${row.label}: ${row.value}`)).toEqual([
			'Number: None',
			'Was: 1a'
		]);
	});

	// DESIGN.md § "Reading a draft": nothing is counted twice, so a note
	// written into and moved is one row saying both.
	it('draws a note that two things happened to once, in the first band it is in', () => {
		const held = rows(
			difference({
				changed: [
					{ ref: ORIGINS, sections: { added: ['b'], removed: [], changed: ['a'], reordered: true } }
				],
				moved: [{ ref: ORIGINS, to: PARSER }],
				retitled: [{ ref: ORIGINS, from: 'Where it began', to: 'Origins' }]
			})
		);
		expect(held).toHaveLength(1);
		expect(held[0].band).toBe('changed');
		expect(held[0].card.rows.map((row) => `${row.label}: ${row.value}`)).toEqual([
			'Sections: 1 written into, 1 new, put in another order',
			'Under: 1a · The parser',
			'Was under: Nothing',
			'Was called: Where it began'
		]);
	});

	it('puts a note that has to be settled first, whatever else happened to it', () => {
		const conflict: ImportConflict = {
			kind: 'note',
			ref: ORIGINS,
			sections: [],
			mine: 'here',
			theirs: 'there'
		};
		const held = rows(
			difference({
				added: [PARSER],
				changed: [
					{ ref: ORIGINS, sections: { added: [], removed: [], changed: ['a'], reordered: false } }
				]
			}),
			[conflict]
		);
		expect(held.map((one) => [one.band, one.ref])).toEqual([
			['settle', ORIGINS],
			['added', PARSER]
		]);
	});
});
