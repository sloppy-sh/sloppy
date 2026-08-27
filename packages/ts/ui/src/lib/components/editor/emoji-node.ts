// An emoji in the writing surface. What is STORED is the shortcode the writer
// typed, so the same text read anywhere resolves the same way; the size comes
// from which syntax was used (`:code:` or `::code::`), never from a flag.

import { InputRule, Node, mergeAttributes } from '@tiptap/core';
import { emojiFor } from '../../emoji/catalog.js';
import { emojiShortcode } from '../../emoji/tokenize.js';

export interface EmojiInsert {
	shortcode: string;
	char: string;
	sticker: boolean;
}

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		emoji: {
			insertEmoji: (entry: EmojiInsert) => ReturnType;
		};
	}
}

const written = (attrs: { name?: string; sticker?: boolean }) =>
	emojiShortcode(attrs.name ?? '', !!attrs.sticker);

const markdownSpec = {
	markdownName: 'emoji',
	renderMarkdown: (node: { attrs?: { name?: string; sticker?: boolean } }): string =>
		written(node.attrs ?? {})
} as Record<string, unknown>;

export const EmojiNode = Node.create({
	name: 'emoji',
	group: 'inline',
	inline: true,
	atom: true,
	selectable: false,
	draggable: false,

	addAttributes() {
		return {
			name: {
				default: '',
				parseHTML: (el) => el.getAttribute('data-emoji') ?? '',
				renderHTML: (attrs) => ({ 'data-emoji': attrs.name })
			},
			char: {
				default: '',
				parseHTML: (el) => el.textContent ?? '',
				renderHTML: () => ({})
			},
			sticker: {
				default: false,
				parseHTML: (el) => el.getAttribute('data-sticker') === 'true',
				renderHTML: (attrs) => ({ 'data-sticker': attrs.sticker ? 'true' : 'false' })
			}
		};
	},

	parseHTML() {
		return [{ tag: 'span[data-emoji]' }];
	},

	renderHTML({ node, HTMLAttributes }) {
		return [
			'span',
			mergeAttributes(HTMLAttributes, {
				class: node.attrs.sticker ? 'sloppy-sticker' : 'sloppy-emoji',
				'aria-label': written(node.attrs)
			}),
			node.attrs.char as string
		];
	},

	renderText({ node }) {
		return written(node.attrs);
	},

	// A shortcode typed out in full becomes the glyph without waiting for the
	// note to be reopened; an unknown one is left exactly as written.
	addInputRules() {
		const rule = (find: RegExp, sticker: boolean) =>
			new InputRule({
				find,
				handler: ({ state, range, match }) => {
					// A colon already in front makes this the tail of `::code::`, which
					// the sticker rule owns. Read back rather than using a lookbehind:
					// Safari gained those in 16.4 and the app supports iOS 16.0, where
					// the literal throws at parse and takes the note surface with it.
					if (!sticker && state.doc.textBetween(Math.max(0, range.from - 1), range.from) === ':')
						return null;
					const emoji = emojiFor(match[1]);
					if (!emoji) return null;
					state.tr.replaceWith(
						range.from,
						range.to,
						this.type.create({ name: emoji.shortcode, char: emoji.char, sticker })
					);
					return undefined;
				}
			});
		return [rule(/::([a-zA-Z0-9_+-]+)::$/, true), rule(/:([a-zA-Z0-9_+-]+):$/, false)];
	},

	addCommands() {
		return {
			insertEmoji:
				(entry: EmojiInsert) =>
				({ commands }) =>
					commands.insertContent({
						type: this.name,
						attrs: { name: entry.shortcode, char: entry.char, sticker: entry.sticker }
					})
		};
	},

	...markdownSpec
});
