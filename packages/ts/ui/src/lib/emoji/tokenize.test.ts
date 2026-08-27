import { describe, expect, it } from 'vitest';
import {
	isCustomEmoji,
	resolveEmoji,
	searchEmoji,
	type CustomEmojiEntry,
	type EmojiEntry
} from './catalog.js';
import { tokenizeContent } from './tokenize.js';

const kinds = (content: string) => tokenizeContent(content).map((t) => t.kind);

const glyph = (entry: EmojiEntry | undefined) =>
	entry && !isCustomEmoji(entry) ? entry.char : undefined;

const MINE: CustomEmojiEntry[] = [
	{ id: 'e1', shortcode: 'party_parrot', src: '/proxy?ref=parrot', sticker: false },
	{ id: 'e2', shortcode: 'fire', src: '/proxy?ref=my-fire', sticker: true }
];

describe('the catalog', () => {
	it('resolves a shortcode to its character', () => {
		expect(glyph(resolveEmoji('seedling'))).toBe('🌱');
		expect(glyph(resolveEmoji('SEEDLING'))).toBe('🌱');
		expect(resolveEmoji('not_an_emoji')).toBeUndefined();
	});

	it('ranks a shortcode prefix above a keyword match', () => {
		const [first] = searchEmoji('seed');
		expect(first.shortcode).toBe('seedling');
	});

	it('finds an emoji by an alias nobody would guess the formal name for', () => {
		expect(glyph(searchEmoji('thumbsup')[0])).toBe('👍');
	});

	it('answers with the picture somebody uploaded for a name Unicode also claims', () => {
		expect(resolveEmoji('fire', MINE)).toBe(MINE[1]);
		expect(glyph(resolveEmoji('fire'))).toBe('🔥');
	});

	it('offers what a person uploaded before the set everybody has', () => {
		expect(searchEmoji('party', 5, MINE)[0]).toBe(MINE[0]);
	});
});

describe('tokenizing stored text', () => {
	it('reads a single-colon shortcode as an inline emoji', () => {
		expect(tokenizeContent('a :fire: thought')).toEqual([
			{ kind: 'text', start: 0, end: 2, value: 'a ' },
			{ kind: 'emoji', start: 2, end: 8, emoji: resolveEmoji('fire'), sticker: false },
			{ kind: 'text', start: 8, end: 16, value: ' thought' }
		]);
	});

	it('reads a double-colon shortcode as a sticker, sized by the syntax alone', () => {
		const [token] = tokenizeContent('::fire::');
		expect(token).toMatchObject({ kind: 'emoji', sticker: true });
		expect(tokenizeContent(':fire:')[0]).toMatchObject({ sticker: false });
	});

	it('leaves a shortcode no emoji claims as text', () => {
		expect(kinds('a :nothing_here: b')).toEqual(['text']);
	});

	it('keeps a DID whole, though its middle looks like a shortcode', () => {
		const did = 'did:syr:z6MkwSiAvviKsS8dvXsScr4ipdeZwusLQY92cWWBisnvpJLc';
		expect(tokenizeContent(`see ${did} for it`)).toEqual([
			{ kind: 'text', start: 0, end: 4, value: 'see ' },
			{ kind: 'did', start: 4, end: 4 + did.length, did },
			{ kind: 'text', start: 4 + did.length, end: 4 + did.length + 7, value: ' for it' }
		]);
	});

	it('keeps a URL whole, though a path segment looks like a shortcode', () => {
		const url = 'https://example.org/wiki/Fire:fire:Water';
		const tokens = tokenizeContent(url);
		expect(tokens).toEqual([{ kind: 'link', start: 0, end: url.length, url }]);
	});

	it('drops sentence punctuation from the end of a URL', () => {
		const tokens = tokenizeContent('read https://example.org/a.');
		expect(tokens[1]).toMatchObject({ kind: 'link', url: 'https://example.org/a' });
		expect(tokens[2]).toMatchObject({ kind: 'text', value: '.' });
	});

	it('does not let the single-colon pattern eat half a sticker', () => {
		expect(tokenizeContent('::fire::').map((t) => t.end)).toEqual([8]);
	});

	it("reads a shortcode against the author's catalog, not the Unicode set", () => {
		const [token] = tokenizeContent('::fire::', MINE);
		expect(token).toMatchObject({ kind: 'emoji', emoji: MINE[1], sticker: true });
	});

	it('covers the whole input exactly once, in order', () => {
		const content = 'x :fire: y ::seedling:: z did:syr:zAbc https://a.example/p :nope: w';
		const tokens = tokenizeContent(content);
		let at = 0;
		for (const token of tokens) {
			expect(token.start).toBe(at);
			at = token.end;
		}
		expect(at).toBe(content.length);
	});
});
