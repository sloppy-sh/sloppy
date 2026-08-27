// Reading `:code:` and `::code::` out of stored text. Ported from slyng's
// `emoji-render`, whose match ORDER is the load-bearing part: spans that
// legitimately contain colons are claimed before any shortcode pattern runs, or
// a `did:syr:…` loses its middle to `:syr:`.

import { resolveEmoji, type CustomEmojiEntry, type EmojiEntry } from './catalog.js';

export type ContentToken =
	| { kind: 'text'; start: number; end: number; value: string }
	| { kind: 'link'; start: number; end: number; url: string }
	| { kind: 'did'; start: number; end: number; did: string }
	| { kind: 'emoji'; start: number; end: number; emoji: EmojiEntry; sticker: boolean };

const DID_RE = /\bdid:[a-z0-9]+:[A-Za-z0-9._%-]+/g;
// slyng linkifies what is left over at the end; a URL is claimed up front here
// instead, because a path segment like `/Foo:Bar:Baz` is otherwise eaten as a
// shortcode and the link is rewritten on the next save.
const URL_RE = /\bhttps?:\/\/[^\s<>]+/g;
const STICKER_RE = /::([a-zA-Z0-9_+-]+)::/g;
// The opening colon is checked in the loop rather than with a lookbehind:
// Safari gained lookbehind in 16.4 and the app supports iOS 16.0, where a
// lookbehind literal throws at parse and takes the whole note surface with it.
const EMOJI_RE = /:([a-zA-Z0-9_+-]+):(?!:)/g;
const URL_TRAILING = /[.,;:!?)\]}'"]+$/;

interface Span {
	start: number;
	end: number;
	token: ContentToken;
}

function claim(spans: Span[], start: number, end: number): boolean {
	return !spans.some((span) => start < span.end && end > span.start);
}

/** `custom` is the catalog the text's AUTHOR wrote against, not the reader's. */
export function tokenizeContent(
	content: string,
	custom: readonly CustomEmojiEntry[] = []
): ContentToken[] {
	if (!content) return [];

	const spans: Span[] = [];
	const push = (start: number, end: number, token: ContentToken) => {
		if (claim(spans, start, end)) spans.push({ start, end, token });
	};

	for (const match of content.matchAll(DID_RE)) {
		const start = match.index;
		push(start, start + match[0].length, {
			kind: 'did',
			start,
			end: start + match[0].length,
			did: match[0]
		});
	}
	for (const match of content.matchAll(URL_RE)) {
		const url = match[0].replace(URL_TRAILING, '');
		if (!url) continue;
		const start = match.index;
		push(start, start + url.length, { kind: 'link', start, end: start + url.length, url });
	}
	// Stickers before emoji: `::x::` contains `:x:`, and whichever runs first wins.
	for (const match of content.matchAll(STICKER_RE)) {
		const emoji = resolveEmoji(match[1], custom);
		if (!emoji) continue;
		const start = match.index;
		push(start, start + match[0].length, {
			kind: 'emoji',
			start,
			end: start + match[0].length,
			emoji,
			sticker: true
		});
	}
	for (const match of content.matchAll(EMOJI_RE)) {
		if (content[match.index - 1] === ':') continue;
		const emoji = resolveEmoji(match[1], custom);
		if (!emoji) continue;
		const start = match.index;
		push(start, start + match[0].length, {
			kind: 'emoji',
			start,
			end: start + match[0].length,
			emoji,
			sticker: false
		});
	}

	spans.sort((a, b) => a.start - b.start);

	const tokens: ContentToken[] = [];
	let cursor = 0;
	for (const span of spans) {
		if (span.start > cursor) {
			tokens.push({
				kind: 'text',
				start: cursor,
				end: span.start,
				value: content.slice(cursor, span.start)
			});
		}
		tokens.push(span.token);
		cursor = span.end;
	}
	if (cursor < content.length) {
		tokens.push({ kind: 'text', start: cursor, end: content.length, value: content.slice(cursor) });
	}
	return tokens;
}

/** The shortcode an emoji is written back as; `sticker` is what makes it big. */
export function emojiShortcode(shortcode: string, sticker: boolean): string {
	return sticker ? `::${shortcode}::` : `:${shortcode}:`;
}
