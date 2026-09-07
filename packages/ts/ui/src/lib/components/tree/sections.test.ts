import type { Address, OwnedRef } from '@sloppy/types';
import { describe, expect, it } from 'vitest';
import {
	aimSection,
	landingAt,
	landingBy,
	type SectionBand,
	sectionSays,
	type TreeSection,
	withSections
} from './sections.js';
import type { TreeRow } from './walk.js';

const DID = 'did:syr:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';

const held = (of: string): OwnedRef => `${DID}/${of}` as OwnedRef;

function row(address: string, depth: number): TreeRow {
	return {
		kind: 'note',
		note: {
			ref: held(address),
			address: address as Address,
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

/** Section rows 40 tall, under a note row that starts at 0. */
function band(sections: readonly TreeSection[] = SECTIONS): SectionBand {
	return {
		top: 0,
		rows: sections.map((one, at) => ({
			ref: one.ref,
			says: one.says,
			top: 40 + at * 40,
			bottom: 80 + at * 40
		}))
	};
}

describe('a note’s sections under its row', () => {
	const shown = new Set([held('1')]);

	it('sets each section in one level under the note it belongs to', () => {
		const rows = withSections([row('1', 0), row('2', 0)], {
			shown,
			of: () => SECTIONS,
			says: () => ''
		});
		expect(rows.map((one) => one.kind)).toEqual(['note', 'section', 'section', 'section', 'note']);
		expect(rows.filter((one) => one.kind === 'section').map((one) => one.depth)).toEqual([1, 1, 1]);
	});

	it('counts each section’s place in the stack it is in', () => {
		const rows = withSections([row('1', 0)], { shown, of: () => SECTIONS, says: () => '' });
		expect(
			rows.filter((one) => one.kind === 'section').map((one) => `${one.at}/${one.of}`)
		).toEqual(['1/3', '2/3', '3/3']);
	});

	it('draws nothing under a note nobody has opened', () => {
		const rows = withSections([row('1', 0)], {
			shown: new Set<OwnedRef>(),
			of: () => SECTIONS,
			says: () => ''
		});
		expect(rows).toHaveLength(1);
	});

	it('says a word under a note that has one to say, beside whatever it holds', () => {
		const rows = withSections([row('1', 0)], {
			shown,
			of: () => SECTIONS,
			says: () => 'That section could not be moved.'
		});
		expect(rows.at(-1)).toMatchObject({
			kind: 'says',
			says: 'That section could not be moved.',
			depth: 1
		});
	});
});

describe('where a dragged section would land', () => {
	it('aims at the gap above the row the pointer is in the top half of', () => {
		expect(aimSection(band(), 45)).toEqual({ slot: 0 });
		expect(aimSection(band(), 85)).toEqual({ slot: 1 });
	});

	it('aims past the last section below the end of the stack', () => {
		expect(aimSection(band(), 155)).toEqual({ slot: 3 });
	});

	// A section belongs to the note it was written in, so there is nowhere for
	// one to go outside its own rows.
	it('aims nowhere above the note and nowhere past its last section', () => {
		expect(aimSection(band(), -5)).toBeNull();
		expect(aimSection(band(), 200)).toBeNull();
	});

	it('says the outcome, and says the refusal in words', () => {
		expect(sectionSays(band(), '1a' as Address, { slot: 0 })).toBe('Put it first in 1a');
		expect(sectionSays(band(), '1a' as Address, { slot: 2 })).toBe('Put it after A drawing');
		expect(sectionSays(band(), '1a' as Address, null)).toBe(
			'A section stays in the note it was written in'
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
