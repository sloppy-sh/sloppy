// Where an element of its own goes. It belongs beside the writing, inside the
// section that holds it — a picture or a drawing dropped into a list item or a
// quote would be nested under prose it has nothing to do with.

import type { JSONContent } from '@tiptap/core';
import type { ResolvedPos } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
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

/** A trailing paragraph comes with an element nothing follows, so there is still
 *  somewhere to carry on writing once it is in. */
export function placeBlock(state: EditorState, node: JSONContent): BlockPlacement {
	const at = afterElement(state.selection.$from) ?? endOfNote(state);
	const following = state.doc.resolve(at).nodeAfter;
	return { at, content: following?.isTextblock ? [node] : [node, { type: 'paragraph' }] };
}
