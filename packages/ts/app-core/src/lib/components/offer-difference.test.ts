import type { BlockDocument, OwnedRef } from '@sloppy/types';
import { describe, expect, it } from 'vitest';
import { ref } from '../stores/fake-api.test-support.js';
import {
	offerDifference,
	offerSaysSomething,
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
		expect(offerSaysSomething(now, side('The opening', [[ONE, 'As it stands']]))).toBe(false);
		expect(sectionsApart(now, side('The opening', [[ONE, 'As it stands']])).sections).toEqual([]);
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

	it('counts a tag on its own as something offered', () => {
		expect(offerSaysSomething(side('', [], ['seed']), side('', [], ['seed', 'question']))).toBe(
			true
		);
	});
});
