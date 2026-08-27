// Looking a shortcode up, and searching for one. The catalog itself is
// `unicode.ts`.

import { UNICODE_EMOJI, type UnicodeEmoji } from './unicode.js';

export type { UnicodeEmoji, UnicodeEmojiCategory } from './unicode.js';
export { UNICODE_EMOJI } from './unicode.js';

const byShortcode = new Map<string, UnicodeEmoji>(
	UNICODE_EMOJI.flatMap((category) => category.emoji).map((emoji) => [emoji.shortcode, emoji])
);

/** Undefined for a shortcode no emoji claims, which stays written as text. */
export function emojiFor(shortcode: string): UnicodeEmoji | undefined {
	return byShortcode.get(shortcode.toLowerCase());
}

/** Shortcode matches first, then keyword matches; both ranked prefix before substring. */
export function searchEmoji(query: string, limit = 24): UnicodeEmoji[] {
	const all = [...byShortcode.values()];
	const q = query.trim().toLowerCase();
	if (!q) return all.slice(0, limit);

	const tiers: UnicodeEmoji[][] = [[], [], [], []];
	for (const emoji of all) {
		const code = emoji.shortcode;
		if (code.startsWith(q)) tiers[0].push(emoji);
		else if (code.includes(q)) tiers[1].push(emoji);
		else if (emoji.keywords?.some((k) => k.startsWith(q))) tiers[2].push(emoji);
		else if (emoji.keywords?.some((k) => k.includes(q))) tiers[3].push(emoji);
	}
	return tiers.flat().slice(0, limit);
}
