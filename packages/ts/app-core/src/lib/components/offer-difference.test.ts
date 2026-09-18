import { compassNode, type BlockDocument, type Compass, type OwnedRef } from '@sloppy/types';
import { describe, expect, it } from 'vitest';
import { ref } from '../stores/fake-api.test-support.js';
import {
	compassApart,
	offerDifference,
	saysAnything,
	saysNothing,
	sectionsApart,
	tagsApart,
	type WritingSide
} from './offer-difference.js';

const NOTE: OwnedRef = ref(1);
const ONE = ref(11);
const TWO = ref(12);
const THREE = ref(13);

function words(said: string): BlockDocument {
	return {
		type: 'doc',
		content: [{ type: 'paragraph', content: [{ type: 'text', text: said }] }]
	};
}

function side(
	title: string,
	sections: readonly [OwnedRef, string][],
	tags: string[] = []
): WritingSide {
	return {
		title,
		tags,
		sections: sections.map(([at, said]) => ({ ref: at, content: words(said) }))
	};
}

describe('a note against the writing offered on it', () => {
	it('names nothing where the two say the same', () => {
		const now = side('The opening', [[ONE, 'As it stands']]);
		const apart = sectionsApart(now, side('The opening', [[ONE, 'As it stands']]));
		expect(apart.sections).toEqual([]);
		expect(apart.reordered).toBe(false);
	});

	it('reads a section by the ref it stands for, not by where it stands', () => {
		const now = side('', [
			[ONE, 'First'],
			[TWO, 'Second']
		]);
		const offered = side('', [
			[TWO, 'Second'],
			[ONE, 'First']
		]);
		const apart = sectionsApart(now, offered);

		expect(apart.sections).toEqual([]);
		expect(apart.reordered).toBe(true);
	});

	it('carries both sides of a section that was written in', () => {
		const apart = sectionsApart(side('', [[ONE, 'As it stands']]), side('', [[ONE, 'Rewritten']]));

		expect(apart.sections).toHaveLength(1);
		expect(apart.sections[0].before).toEqual(words('As it stands'));
		expect(apart.sections[0].after).toEqual(words('Rewritten'));
	});

	it('shows a section the offer adds with no side before it', () => {
		const apart = sectionsApart(
			side('', [[ONE, 'As it stands']]),
			side('', [
				[ONE, 'As it stands'],
				[THREE, 'And another thing']
			])
		);

		expect(apart.sections).toHaveLength(1);
		expect(apart.sections[0].before).toBeUndefined();
		expect(apart.sections[0].after).toEqual(words('And another thing'));
	});

	it('shows a section the offer takes out with no side after it', () => {
		const apart = sectionsApart(
			side('', [
				[ONE, 'As it stands'],
				[TWO, 'The second thought']
			]),
			side('', [[ONE, 'As it stands']])
		);

		expect(apart.sections).toHaveLength(1);
		expect(apart.sections[0].before).toEqual(words('The second thought'));
		expect(apart.sections[0].after).toBeUndefined();
	});

	// An offer changes what a note says and never whether it is there.
	it('draws as a note that is kept, under the title the offer would give it', () => {
		const drawn = offerDifference(
			{ ref: NOTE, address: '1a' },
			side('The opening', [[ONE, 'As it stands']]),
			side('A clearer opening', [[ONE, 'Rewritten']])
		);

		expect(drawn.became).toBe('kept');
		expect(drawn.address).toBe('1a');
		expect(drawn.title).toBe('A clearer opening');
		expect(drawn.retitled).toEqual({ from: 'The opening' });
	});

	it('names the words the offer would add and take off', () => {
		const apart = tagsApart(side('', [], ['seed', 'biology']), side('', [], ['seed', 'question']));

		expect(apart.added).toEqual(['question']);
		expect(apart.removed).toEqual(['biology']);
	});
});

const NOWHERE: Compass = { north: [], south: [], east: [], west: [] };

/** One section holding a compass, under a line of writing. */
function pointing(at: OwnedRef, slots: Partial<Compass>, said = 'The decision'): WritingSide {
	return {
		title: '',
		tags: [],
		sections: [
			{
				ref: at,
				content: {
					type: 'doc',
					content: [
						{ type: 'paragraph', content: [{ type: 'text', text: said }] },
						compassNode({ ...NOWHERE, ...slots })
					]
				}
			}
		]
	};
}

describe('where an offer would have the note point', () => {
	it('names nothing where neither side points anywhere', () => {
		expect(
			compassApart(side('', [[ONE, 'As it stands']]), side('', [[ONE, 'As it stands']]))
		).toEqual([]);
	});

	it('names the slot that gained a note, and no other', () => {
		const apart = compassApart(pointing(ONE, {}), pointing(ONE, { north: [TWO] }));

		expect(apart).toEqual([{ direction: 'north', gained: [TWO], lost: [] }]);
	});

	it('names a note a slot no longer points at', () => {
		const apart = compassApart(pointing(ONE, { west: [TWO] }), pointing(ONE, { west: [] }));

		expect(apart).toEqual([{ direction: 'west', gained: [], lost: [TWO] }]);
	});

	it('reads the slots in the order a compass is read in', () => {
		const apart = compassApart(
			pointing(ONE, {}),
			pointing(ONE, { west: [TWO], north: [THREE], east: [TWO] })
		);

		expect(apart.map((slot) => slot.direction)).toEqual(['north', 'east', 'west']);
	});

	// A slot that gained a note is read as the slot it is, not as a block of
	// changed markup — DESIGN.md § "The compass card".
	it('leaves a section that changed only in its compass out of the difference', () => {
		const now = pointing(ONE, {});
		const offered = pointing(ONE, { north: [TWO] });

		expect(sectionsApart(now, offered).sections).toEqual([]);
		expect(saysAnything(offerDifference({ ref: NOTE }, now, offered))).toBe(false);
	});

	it('says an offer that only adds a word is not nothing', () => {
		const now = side('The opening', [[ONE, 'As it stands']]);
		const offered = side('The opening', [[ONE, 'As it stands']], ['biology']);
		const apart = offerDifference({ ref: NOTE }, now, offered);

		expect(saysAnything(apart)).toBe(false);
		expect(saysNothing(apart, compassApart(now, offered), tagsApart(now, offered))).toBe(false);
	});

	it('says an offer that changes nothing at all is nothing', () => {
		const now = side('The opening', [[ONE, 'As it stands']], ['biology']);
		const apart = offerDifference({ ref: NOTE }, now, now);

		expect(saysNothing(apart, compassApart(now, now), tagsApart(now, now))).toBe(true);
	});

	it('still shows the writing where the section changed around the compass', () => {
		const now = pointing(ONE, {}, 'The decision');
		const offered = pointing(ONE, { north: [TWO] }, 'The decision, sharpened');

		expect(sectionsApart(now, offered).sections).toHaveLength(1);
		expect(compassApart(now, offered)).toHaveLength(1);
	});
});
