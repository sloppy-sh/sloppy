// `[[`-triggered note completion, on the same footing as the `:` shortcodes in
// `./emoji-suggestion.svelte.ts`: one `@tiptap/suggestion` plugin, one state
// object, one popup.

import type { NodeView } from '@sloppy/types';
import { Extension, type Editor } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import type { NoteReferences } from './contract.js';
import { citedAs, REFERENCE_NODE } from './reference-node.js';

const SHOWN = 6;
/** How many notes from the author's other graphs are offered beside them. Fewer,
 *  because writing here is the primary act and reaching across is the second. */
const SHOWN_ELSEWHERE = 4;
/** Past this many characters what follows `[[` is a sentence rather than a name,
 *  and the menu lets go of it. */
const NAME_LIMIT = 80;

/** A note to reference, or a note to write and then reference. `graph` is what
 *  the author calls the graph a note is in, and is carried only for one in
 *  another graph than the note being written. */
export type NoteChoice =
	| { kind: 'note'; note: NodeView; graph?: string }
	| { kind: 'make'; name: string; relation: 'under' | 'after' };

const COULD_NOT_WRITE = 'That note could not be added. Try again in a moment.';

export class NoteCompletions {
	open = $state(false);
	items = $state<NoteChoice[]>([]);
	index = $state(0);
	rect = $state<DOMRect | null>(null);
	/** The name of the note being written, while it is being written. */
	making = $state<string | null>(null);
	refused = $state<string | null>(null);
	#choose: ((choice: NoteChoice) => void) | null = null;

	show(items: NoteChoice[], choose: (choice: NoteChoice) => void, rect: DOMRect | null): void {
		this.items = items;
		this.index = Math.min(this.index, Math.max(0, items.length - 1));
		this.rect = rect;
		this.refused = null;
		this.#choose = choose;
		this.open = items.length > 0;
	}

	close(): void {
		this.open = false;
		this.items = [];
		this.index = 0;
		this.rect = null;
		this.making = null;
		this.refused = null;
		this.#choose = null;
	}

	/** Nothing is written until somebody picks the row that writes it. */
	pick(choice: NoteChoice): void {
		if (this.making !== null) return;
		this.#choose?.(choice);
	}

	writing(name: string): void {
		this.making = name;
		this.refused = null;
	}

	refuse(message: string): void {
		this.making = null;
		this.refused = message;
	}

	/** True when the key was spent here rather than in the document. */
	onKeyDown(event: KeyboardEvent): boolean {
		if (!this.open) return false;
		// ProseMirror answers a key it handled with `preventDefault()` alone, and
		// the sheet's escape layer does not consult that — so without this, the one
		// key that dismisses the menu shuts the note under it as well.
		if (event.key === 'Escape' || event.key === 'Esc') {
			event.stopPropagation();
			return true;
		}
		if (this.making !== null || this.items.length === 0) return false;
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
			default:
				return false;
		}
	}
}

/** `@tiptap/suggestion` does not export its plugin state; this is the part of it
 *  a pick reads. */
interface SuggestionState {
	active: boolean;
	range: { from: number; to: number };
}

const referenceSuggestionKey = new PluginKey<SuggestionState>('referenceSuggestion');

function choicesFor(query: string, references: NoteReferences | undefined): NoteChoice[] {
	if (!references || query.includes(']')) return [];
	const name = query.trim();
	if (name.length > NAME_LIMIT) return [];
	const found = references.find(name);
	const cite = (note: NodeView): NoteChoice => ({ kind: 'note', note });
	// Writing a note here stays the primary act, so what is offered from another
	// graph comes after it rather than in front of it.
	const away: NoteChoice[] = references
		.elsewhere(name)
		.slice(0, SHOWN_ELSEWHERE)
		.map(({ note, graph }) => ({ kind: 'note', note, graph }));
	if (!name) return [...found.slice(0, SHOWN).map(cite), ...away];

	const wanted = name.toLowerCase();
	// A name a note already carries is that note, wherever its address sorts it,
	// and writing a second one under the same words would only make the pair
	// ambiguous.
	const carrying = found.filter((note) => note.title.toLowerCase() === wanted);
	const shown = [...carrying, ...found.filter((note) => note.title.toLowerCase() !== wanted)]
		.slice(0, SHOWN)
		.map(cite);
	if (carrying.length > 0) return [...shown, ...away];
	return [
		...shown,
		{ kind: 'make', name, relation: 'under' },
		{ kind: 'make', name, relation: 'after' },
		...away
	];
}

/** The span a reference replaces: the `[[…` the caret stands at the end of. */
interface Trigger {
	from: number;
	to: number;
	text: string;
}

/** Where the caret is, as a span that replaces nothing. */
function caretAt(editor: Editor): Trigger {
	const at = editor.state.selection.$from.pos;
	return { from: at, to: at, text: '' };
}

/** Read from the plugin's live state, never from the range handed to `command`:
 *  that one closed over an earlier render and can be a keystroke behind. Reading
 *  it is also what keeps the span replaced identical to the span the menu
 *  matched, whatever the query has in it. */
function triggerAt(editor: Editor): Trigger {
	const live = referenceSuggestionKey.getState(editor.state);
	if (!live?.active) return caretAt(editor);
	const { from, to } = live.range;
	return { from, to, text: editor.state.doc.textBetween(from, to, '\n', '￼') };
}

/** Whether the span is still the one that was read, so replacing it cannot take
 *  anything typed since. */
function stillThere(editor: Editor, at: Trigger): boolean {
	const { doc } = editor.state;
	if (at.to > doc.content.size) return false;
	return doc.textBetween(at.from, at.to, '\n', '￼') === at.text;
}

function place(editor: Editor, at: Trigger, note: NodeView): void {
	editor
		.chain()
		.focus()
		.insertContentAt({ from: at.from, to: at.to }, [
			{ type: REFERENCE_NODE, attrs: { note: note.ref, label: citedAs(note) } },
			{ type: 'text', text: ' ' }
		])
		.run();
}

async function take(
	editor: Editor,
	choice: NoteChoice,
	references: NoteReferences | undefined,
	completions: NoteCompletions
): Promise<void> {
	const at = triggerAt(editor);
	if (choice.kind === 'note') {
		place(editor, at, choice.note);
		completions.close();
		return;
	}
	if (!references) return;
	completions.writing(choice.name);
	let written: NodeView;
	try {
		written = await references.write(choice.name, choice.relation);
	} catch (error: unknown) {
		completions.refuse(error instanceof Error && error.message ? error.message : COULD_NOT_WRITE);
		return;
	}
	if (editor.isDestroyed) return;
	// A span that shifted while the note was being written is not the span to
	// replace, so the reference lands at the caret rather than over the typing.
	place(editor, stillThere(editor, at) ? at : caretAt(editor), written);
	completions.close();
}

export function ReferenceSuggestion(
	completions: NoteCompletions,
	references: () => NoteReferences | undefined
) {
	return Extension.create({
		name: 'referenceSuggestion',
		addProseMirrorPlugins() {
			return [
				Suggestion<NoteChoice>({
					editor: this.editor,
					pluginKey: referenceSuggestionKey,
					char: '[[',
					// A note is found by its title, and titles have spaces in them.
					allowSpaces: true,
					// `[[` is its own prefix, so nothing about what precedes it decides
					// whether it triggers.
					allowedPrefixes: null,
					startOfLine: false,
					items: ({ query }) => choicesFor(query, references()),
					command: ({ editor, props }) => void take(editor, props, references(), completions),
					render: () => ({
						onStart: (p) =>
							completions.show(p.items, (c) => p.command(c), p.clientRect?.() ?? null),
						onUpdate: (p) =>
							completions.show(p.items, (c) => p.command(c), p.clientRect?.() ?? null),
						onKeyDown: (p) => completions.onKeyDown(p.event),
						onExit: () => completions.close()
					})
				})
			];
		}
	});
}
