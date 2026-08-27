import { describe, expect, it } from 'vitest';
import { isCustomEmoji, resolveEmoji, searchEmoji, type CustomEmojiEntry } from './catalog.js';

const FIRE: CustomEmojiEntry = {
	id: 'e1',
	shortcode: 'fire',
	src: '/proxy?ref=fire',
	sticker: false
};

describe('a catalog entry named after a Unicode emoji', () => {
	it('is the one that answers to the name', () => {
		expect(resolveEmoji('fire', [FIRE])).toBe(FIRE);
	});

	// Both the picker and the caret popup key their lists by shortcode, so a
	// second claimant to a name takes the list down rather than ranking below.
	it('is the only claimant a search offers under it', () => {
		const found = searchEmoji('fire', 60, [FIRE]);
		const names = found.map((entry) => entry.shortcode);

		expect(new Set(names).size).toBe(names.length);
		expect(found[0]).toBe(FIRE);
		expect(found.filter(isCustomEmoji)).toEqual([FIRE]);
	});

	it('stays the only claimant when nothing has been typed', () => {
		const names = searchEmoji('', 500, [FIRE]).map((entry) => entry.shortcode);
		expect(new Set(names).size).toBe(names.length);
	});
});
