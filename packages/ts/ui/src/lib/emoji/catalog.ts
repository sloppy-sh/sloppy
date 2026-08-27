// Looking a shortcode up, and searching for one. Two kinds of emoji answer to a
// shortcode: the Unicode set (`unicode.ts`) and the pictures an identity
// uploaded, which `catalogs.svelte.ts` holds one catalog of per DID.

import { UNICODE_EMOJI, type UnicodeEmoji } from './unicode.js';

export type { UnicodeEmoji, UnicodeEmojiCategory } from './unicode.js';
export { UNICODE_EMOJI } from './unicode.js';

/** One somebody uploaded, with `src` already resolved into something an
 *  `<img>` may load — a foreign address never reaches one raw. */
export interface CustomEmojiEntry {
	/** The catalog row it came from, so an action can name it. */
	id: string;
	shortcode: string;
	src: string;
	/** How big it draws, and so which syntax cites it: `::code::` over `:code:`. */
	sticker: boolean;
}

export type EmojiEntry = UnicodeEmoji | CustomEmojiEntry;

export function isCustomEmoji(entry: EmojiEntry): entry is CustomEmojiEntry {
	return 'src' in entry;
}

const byShortcode = new Map<string, UnicodeEmoji>(
	UNICODE_EMOJI.flatMap((category) => category.emoji).map((emoji) => [emoji.shortcode, emoji])
);

/**
 * Undefined for a shortcode nothing claims, which stays written as text. A
 * catalog answers before the Unicode set: a name somebody uploaded a picture
 * for is theirs, even where Unicode claims it too.
 */
export function resolveEmoji(
	shortcode: string,
	custom: readonly CustomEmojiEntry[] = []
): EmojiEntry | undefined {
	const code = shortcode.toLowerCase();
	return custom.find((entry) => entry.shortcode.toLowerCase() === code) ?? byShortcode.get(code);
}

/** Shortcode matches first, then keyword matches; both ranked prefix before
 *  substring, and a catalog entry ahead of the Unicode set at every tier. */
export function searchEmoji(
	query: string,
	limit = 24,
	custom: readonly CustomEmojiEntry[] = []
): EmojiEntry[] {
	const all: EmojiEntry[] = [...custom, ...byShortcode.values()];
	const q = query.trim().toLowerCase();
	if (!q) return all.slice(0, limit);

	const tiers: EmojiEntry[][] = [[], [], [], []];
	for (const emoji of all) {
		const code = emoji.shortcode.toLowerCase();
		const keywords = isCustomEmoji(emoji) ? undefined : emoji.keywords;
		if (code.startsWith(q)) tiers[0].push(emoji);
		else if (code.includes(q)) tiers[1].push(emoji);
		else if (keywords?.some((k) => k.startsWith(q))) tiers[2].push(emoji);
		else if (keywords?.some((k) => k.includes(q))) tiers[3].push(emoji);
	}
	return tiers.flat().slice(0, limit);
}
