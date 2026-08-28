// `:`-triggered emoji completion. Ported from slyng's post editor, with its
// hosted catalog swapped for the shortcodes Sloppy ships (`$lib/emoji`).

import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import { searchEmoji, type CustomEmojiEntry, type EmojiEntry } from '../../emoji/catalog.js';
import { citedLarge, emojiInsert } from './emoji-node.js';

const SHOWN = 12;

export class EmojiCompletions {
	open = $state(false);
	items = $state<EmojiEntry[]>([]);
	index = $state(0);
	rect = $state<DOMRect | null>(null);
	#choose: ((emoji: EmojiEntry) => void) | null = null;

	show(items: EmojiEntry[], choose: (emoji: EmojiEntry) => void, rect: DOMRect | null): void {
		this.items = items;
		this.index = Math.min(this.index, Math.max(0, items.length - 1));
		this.rect = rect;
		// The closure from the empty-query range covers only the ':', so a stale one
		// replaces the colon and leaves the typed query behind.
		this.#choose = choose;
		this.open = items.length > 0;
	}

	close(): void {
		this.open = false;
		this.items = [];
		this.index = 0;
		this.rect = null;
		this.#choose = null;
	}

	pick(emoji: EmojiEntry): void {
		this.#choose?.(emoji);
	}

	/** True when the key was spent here rather than in the document. */
	onKeyDown(event: KeyboardEvent): boolean {
		if (!this.open || this.items.length === 0) return false;
		switch (event.key) {
			case 'ArrowDown':
				this.index = (this.index + 1) % this.items.length;
				return true;
			case 'ArrowUp':
				this.index = (this.index - 1 + this.items.length) % this.items.length;
				return true;
			case 'Enter':
			case 'Tab':
				this.pick(this.items[this.index]);
				return true;
			case 'Escape':
				this.close();
				return true;
			default:
				return false;
		}
	}
}

const emojiSuggestionKey = new PluginKey('emojiSuggestion');

export function EmojiSuggestion(
	completions: EmojiCompletions,
	custom: () => readonly CustomEmojiEntry[]
) {
	return Extension.create({
		name: 'emojiSuggestion',
		addProseMirrorPlugins() {
			return [
				Suggestion<EmojiEntry>({
					editor: this.editor,
					pluginKey: emojiSuggestionKey,
					char: ':',
					allowSpaces: false,
					// The trigger stays in the query so typing the second colon of `::`
					// does not break the match and close the list.
					allowToIncludeChar: true,
					startOfLine: false,
					items: ({ query }) =>
						searchEmoji(query.startsWith(':') ? query.slice(1) : query, SHOWN, custom()),
					command: ({ editor, props }) => {
						// The live document, not the passed range: that closure can be a
						// keystroke behind, and replacing the wrong span eats the query.
						const { selection } = editor.state;
						const to = selection.$from.pos;
						const before = selection.$from.parent.textBetween(
							Math.max(0, selection.$from.parentOffset - 100),
							selection.$from.parentOffset,
							'\n',
							'￼'
						);
						const typed = before.match(/:{1,2}[^\s:]*$/);
						const from = typed ? to - typed[0].length : to;
						const large = !!typed && typed[0].startsWith('::');
						const entry = emojiInsert(props, citedLarge(props, large));
						editor
							.chain()
							.focus()
							.insertContentAt({ from, to }, [
								{
									type: 'emoji',
									attrs: {
										name: entry.shortcode,
										char: entry.char,
										src: entry.src,
										sticker: entry.sticker
									}
								},
								{ type: 'text', text: ' ' }
							])
							.run();
					},
					render: () => ({
						onStart: (p) =>
							completions.show(p.items, (e) => p.command(e), p.clientRect?.() ?? null),
						onUpdate: (p) =>
							completions.show(p.items, (e) => p.command(e), p.clientRect?.() ?? null),
						onKeyDown: (p) => completions.onKeyDown(p.event),
						onExit: () => completions.close()
					})
				})
			];
		}
	});
}
