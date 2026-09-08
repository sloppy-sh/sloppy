import type { Address, OwnedRef } from '@sloppy/types';
import { describe, expect, it } from 'vitest';
import {
	aimCarry,
	aimSection,
	carrySays,
	landingAt,
	landingBy,
	type SectionBand,
	type TreeSection,
	withSections
} from './sections.js';
import type { TreeBox } from './tree-drag.js';
import type { TreeRow } from './walk.js';

const DID = 'did:syr:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';

const held = (of: string): OwnedRef => `${DID}/${of}` as OwnedRef;

/** Every fixture note is written in the same moment; what orders these runs
 *  is their addresses. */
const WRITTEN = '2026-01-01T00:00:00.000Z';

function row(address: string, depth: number): TreeRow {
	return {
		kind: 'note',
		note: {
			ref: held(address),
			address: address as Address,
			created_at: WRITTEN,
			title: `About ${address}`,
			tags: [],
			published: false
		},
		depth,
		children: 0,
		under: 0,
		open: false,
		at: 1,
		of: 1
	};
}

const SECTIONS: TreeSection[] = [
	{ ref: held('s1'), says: 'The first thing' },
	{ ref: held('s2'), says: 'A drawing' },
	{ ref: held('s3'), says: 'The last thing' }
];

/** One note's interior, its sections 40 tall inside it. */
function band(note = '1a', sections: readonly TreeSection[] = SECTIONS, from = 40): SectionBand {
	return {
		note: held(note),
		named: note,
		top: from,
		bottom: from + sections.length * 40 + 20,
		rows: sections.map((one, at) => ({
			ref: one.ref,
			says: one.says,
			top: from + at * 40,
			bottom: from + 40 + at * 40
		}))
	};
}

/** Note rows 44 tall, their words set in by their depth. */
function boxes(...rows: { address: string; top: number; depth?: number }[]): TreeBox[] {
	return rows.map((one) => ({
		on: held(one.address),
		address: one.address as Address,
		title: `About ${one.address}`,
		top: one.top,
		bottom: one.top + 44,
		left: 10 + (one.depth ?? 0) * 20
	}));
}

const OWN = { note: held('1a'), named: '1a' };

describe('a note’s sections under its row', () => {
	const shown = new Set([held('1')]);

	it('says a word under a note that has one to say', () => {
		const rows = withSections([row('1', 0), row('2', 0)], {
			shown,
			says: () => ({ says: 'That section could not be moved.', again: true })
		});
		expect(rows.map((one) => one.kind)).toEqual(['note', 'says', 'note']);
		expect(rows[1]).toMatchObject({
			kind: 'says',
			says: 'That section could not be moved.',
			again: true,
			depth: 1
		});
	});

	it('says nothing under a note with nothing to say', () => {
		const rows = withSections([row('1', 0)], {
			shown,
			says: () => ({ says: '', again: false })
		});
		expect(rows).toHaveLength(1);
	});

	it('says nothing under a note nobody has opened', () => {
		const rows = withSections([row('1', 0)], {
			shown: new Set<OwnedRef>(),
			says: () => ({ says: 'Reading this note…', again: false })
		});
		expect(rows).toHaveLength(1);
	});
});

describe('where a dragged section would land inside one note', () => {
	it('aims at the gap above the section the pointer is in the top half of', () => {
		expect(aimSection(band(), 45)).toEqual({ slot: 0 });
		expect(aimSection(band(), 85)).toEqual({ slot: 1 });
	});

	it('aims past the last section below the end of the stack', () => {
		expect(aimSection(band(), 175)).toEqual({ slot: 3 });
	});

	it('aims nowhere outside the note’s own interior', () => {
		expect(aimSection(band(), 5)).toBeNull();
		expect(aimSection(band(), 400)).toBeNull();
	});
});

describe('where a carried section would land in the outline', () => {
	const rows = boxes(
		{ address: '1a', top: 0 },
		{ address: '2', top: 400 },
		{ address: '3', top: 444, depth: 1 }
	);
	const bands = [band('1a', SECTIONS, 44)];

	it('lands in the stack of the note whose interior it is over', () => {
		expect(aimCarry(bands, rows, 0, 90)).toEqual({
			kind: 'stack',
			note: held('1a'),
			named: '1a',
			slot: 1,
			after: held('s1')
		});
	});

	it('lands on the note whose row it is over, at the end of that note', () => {
		expect(aimCarry(bands, rows, 0, 422)).toEqual({
			kind: 'onto',
			note: held('2'),
			named: '2'
		});
	});

	it('becomes a note in the run beside a row it is let go at the edge of', () => {
		expect(aimCarry(bands, rows, 0, 404)).toEqual({
			kind: 'note',
			on: held('2'),
			named: '2',
			relation: 'after'
		});
	});

	it('becomes a note under a row it is let go past the row’s own words', () => {
		expect(aimCarry(bands, rows, 60, 440)).toEqual({
			kind: 'note',
			on: held('2'),
			named: '2',
			relation: 'under'
		});
	});

	it('lands nowhere above the first row', () => {
		expect(aimCarry([], rows, 0, -10)).toBeNull();
	});
});

describe('what a carried section says before it is let go', () => {
	const bands = [band('1a', SECTIONS, 44)];

	const mine = (slot: number) =>
		({ kind: 'stack', note: OWN.note, named: OWN.named, slot, after: null }) as const;

	it('names the section it would follow inside its own note', () => {
		expect(carrySays(mine(0), OWN, bands)).toBe('Put it first in 1a');
		expect(carrySays(mine(2), OWN, bands)).toBe('Put it after A drawing');
	});

	it('counts the place it takes in another note’s stack', () => {
		const into = { kind: 'stack', note: held('2a'), named: '2a', after: null } as const;
		expect(carrySays({ ...into, slot: 0 }, OWN, bands)).toBe('Into 2a, first');
		expect(carrySays({ ...into, slot: 1 }, OWN, bands)).toBe('Into 2a, after the first section');
		expect(carrySays({ ...into, slot: 3 }, OWN, bands)).toBe('Into 2a, after the third section');
	});

	it('says a note it is dropped on takes it at the end', () => {
		expect(carrySays({ kind: 'onto', note: held('3'), named: '3' }, OWN, bands)).toBe(
			'Onto 3, at the end'
		);
	});

	it('says a section dropped back on its own note stays where it is', () => {
		expect(carrySays({ kind: 'onto', note: OWN.note, named: OWN.named }, OWN, bands)).toBe(
			'Stays where it is'
		);
	});

	it('says the run a section let go between two rows becomes a note in', () => {
		expect(
			carrySays({ kind: 'note', on: held('2'), named: '2', relation: 'under' }, OWN, bands)
		).toBe('Becomes a note under 2');
		expect(
			carrySays({ kind: 'note', on: held('2'), named: '2', relation: 'after' }, OWN, bands)
		).toBe('Becomes a note beside 2');
	});

	it('asks for somewhere to put it while it is over nowhere', () => {
		expect(carrySays(null, OWN, bands)).toBe(
			'Move it over a note, or between two, to put it there'
		);
	});
});

describe('what a move asks the note for', () => {
	it('names the section the moved one then follows', () => {
		expect(landingAt(SECTIONS, held('s1'), 2)).toEqual({ after: held('s2') });
		expect(landingAt(SECTIONS, held('s1'), 3)).toEqual({ after: held('s3') });
	});

	it('names nothing where the section goes first', () => {
		expect(landingAt(SECTIONS, held('s3'), 0)).toEqual({ after: null });
	});

	it('moves nothing for a drop in either gap the section already touches', () => {
		expect(landingAt(SECTIONS, held('s2'), 1)).toBeNull();
		expect(landingAt(SECTIONS, held('s2'), 2)).toBeNull();
	});

	it('moves nothing for a section that is not in this stack', () => {
		expect(landingAt(SECTIONS, held('s9'), 0)).toBeNull();
	});

	it('takes one step up and one step down', () => {
		expect(landingBy(SECTIONS, held('s3'), -1)).toEqual({ after: held('s1') });
		expect(landingBy(SECTIONS, held('s1'), 1)).toEqual({ after: held('s2') });
	});

	it('stays put at either end of the stack', () => {
		expect(landingBy(SECTIONS, held('s1'), -1)).toBeNull();
		expect(landingBy(SECTIONS, held('s3'), 1)).toBeNull();
	});
});
