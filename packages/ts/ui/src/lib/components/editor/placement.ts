// Where an element of its own goes. It belongs beside the writing, inside the
// section that holds it — a picture or a drawing dropped into a list item or a
// quote would be nested under prose it has nothing to do with.

import type { JSONContent, Range } from '@tiptap/core';
import type { Node as ProseMirrorNode, ResolvedPos } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { SECTION_NODE } from './section-node.js';

export interface BlockPlacement {
	at: number;
	content: JSONContent[];
}

/** Just past the element this position is in, still inside its section. Null
 *  where the position is in no section at all. */
export function afterElement($pos: ResolvedPos): number | null {
	if ($pos.parent.type.name === SECTION_NODE) return $pos.pos;
	for (let depth = $pos.depth; depth > 0; depth--) {
		if ($pos.node(depth - 1).type.name === SECTION_NODE) return $pos.after(depth);
	}
	return null;
}

/** The end of the note's last section, where an element with nowhere else to go
 *  lands. */
export function endOfNote(state: EditorState): number {
	return Math.max(1, state.doc.content.size - 1);
}

/**
 * Puts `node` where the line an input rule matched stood, for a rule whose
 * syntax IS the whole line, with the same trailing paragraph {@link placeBlock}
 * leaves. Null — nothing written — where the line holds anything besides what
 * was typed, or where what holds it will not take the element; the position of
 * the new element otherwise.
 */
export function replaceBlock(tr: Transaction, range: Range, node: ProseMirrorNode): number | null {
	const $from = tr.doc.resolve(range.from);
	if (!$from.parent.isTextblock || $from.depth === 0) return null;
	if ($from.parent.content.size !== range.to - range.from) return null;
	const at = $from.before();
	const $at = tr.doc.resolve(at);
	if (!$at.parent.canReplaceWith($at.index(), $at.index() + 1, node.type)) return null;
	const following = $at.parent.maybeChild($at.index() + 1);
	const paragraph = node.type.schema.nodes.paragraph;
	const written = following?.isTextblock ? [node] : [node, paragraph.create()];
	tr.replaceWith(at, $from.after(), written);
	return at;
}

/** A trailing paragraph comes with an element nothing follows, so there is still
 *  somewhere to carry on writing once it is in. Measured from the END of what is
 *  selected, so an element added while another one is selected lands after it
 *  rather than in front of it. */
export function placeBlock(state: EditorState, node: JSONContent): BlockPlacement {
	const at = afterElement(state.selection.$to) ?? endOfNote(state);
	const following = state.doc.resolve(at).nodeAfter;
	return { at, content: following?.isTextblock ? [node] : [node, { type: 'paragraph' }] };
}
