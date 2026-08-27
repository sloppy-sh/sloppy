// Where a block of its own goes. A node's interior is a flat stack whose top
// level IS the rows — `./document.ts` reads nothing below it — so a picture or
// a drawing dropped inside a list item or a quote is a block the note never
// stores. It lands after the top-level node the caret is in instead.

import type { JSONContent } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';

export interface BlockPlacement {
	at: number;
	content: JSONContent[];
}

/** A trailing paragraph comes with a block nothing follows, so there is still
 *  somewhere to carry on writing once it is in. */
export function placeBlock(state: EditorState, node: JSONContent): BlockPlacement {
	const { $from } = state.selection;
	const at = $from.depth === 0 ? $from.pos : $from.after(1);
	const following = state.doc.resolve(at).nodeAfter;
	return { at, content: following?.isTextblock ? [node] : [node, { type: 'paragraph' }] };
}
