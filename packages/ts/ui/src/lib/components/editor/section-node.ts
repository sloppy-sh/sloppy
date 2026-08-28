// A block, as somebody writing meets it: a bounded section of the note holding
// as many elements as they put in it. Enter makes a paragraph inside one; only
// `addSection` makes another — AI.md § "A Block Is a Section".
//
// One section is one row, and `blockUid` is what says which: `./document.ts`
// owns that correspondence.

import { Node, mergeAttributes } from '@tiptap/core';
import type { ResolvedPos } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';

export const SECTION_NODE = 'section';

/** A note is sections and nothing else, which is what stops Enter from ever
 *  making one. */
export const NoteDocument = Node.create({
	name: 'doc',
	topNode: true,
	content: `${SECTION_NODE}+`
});

let sequence = 0;
export function nextUid(): string {
	return `b${++sequence}`;
}

/** The depth of the section a position sits in, or null where none does. */
export function sectionDepth($pos: ResolvedPos): number | null {
	for (let depth = $pos.depth; depth > 0; depth--) {
		if ($pos.node(depth).type.name === SECTION_NODE) return depth;
	}
	return null;
}

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		section: {
			addSection: () => ReturnType;
		};
	}
}

/** A section holding nothing, backspaced into from its first line, goes — which
 *  is how one added by mistake is taken back. The last one stays: a note always
 *  has somewhere to write. */
function removeEmptySection(state: EditorState): { from: number; to: number } | null {
	const { $from, empty } = state.selection;
	if (!empty || $from.parentOffset !== 0 || state.doc.childCount < 2) return null;
	const depth = sectionDepth($from);
	if (depth === null) return null;
	const section = $from.node(depth);
	if (section.childCount > 1 || (section.firstChild?.content.size ?? 0) > 0) return null;
	return { from: $from.before(depth), to: $from.after(depth) };
}

export const SectionNode = Node.create({
	name: SECTION_NODE,
	content: 'block+',
	defining: true,
	// Nothing crosses a section's edge: a split stays inside it, and a join
	// cannot pull the section before it in. That is the whole rule, in the schema.
	isolating: true,

	addAttributes() {
		return {
			// Carried on the element so a section cut and pasted back into the note
			// is the same row moved, not the old one deleted and a new one made.
			blockUid: {
				default: null,
				parseHTML: (el) => el.getAttribute('data-block-uid'),
				renderHTML: (attrs) => (attrs.blockUid ? { 'data-block-uid': attrs.blockUid } : {})
			},
			blockRef: {
				default: null,
				parseHTML: (el) => el.getAttribute('data-block-ref'),
				renderHTML: (attrs) => (attrs.blockRef ? { 'data-block-ref': attrs.blockRef } : {})
			}
		};
	},

	parseHTML() {
		return [{ tag: 'section[data-section]' }];
	},

	renderHTML({ HTMLAttributes }) {
		return ['section', mergeAttributes(HTMLAttributes, { 'data-section': 'true' }), 0];
	},

	addCommands() {
		return {
			addSection:
				() =>
				({ state, tr, dispatch }) => {
					const made = state.schema.nodes[SECTION_NODE].createAndFill();
					if (!made) return false;
					const at = state.doc.content.size;
					if (dispatch) {
						tr.insert(at, made);
						tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)));
						dispatch(tr.scrollIntoView());
					}
					return true;
				}
		};
	},

	addKeyboardShortcuts() {
		return {
			Backspace: ({ editor }) => {
				const { state, view } = editor;
				const found = removeEmptySection(state);
				if (!found) return false;
				const tr = state.tr.delete(found.from, found.to);
				const at = found.from === 0 ? 0 : found.from - 1;
				tr.setSelection(TextSelection.near(tr.doc.resolve(at), found.from === 0 ? 1 : -1));
				view.dispatch(tr.scrollIntoView());
				return true;
			}
		};
	},

	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: new PluginKey('sectionIdentity'),
				// A split copies its origin's attributes, so the copy is the section
				// that has to be renamed: the first holding a uid keeps it, and every
				// later claimant becomes a new, unsaved section.
				appendTransaction: (_transactions, _old, state) => {
					const claimed = new Set<string>();
					let tr: ReturnType<typeof state.tr.setNodeMarkup> | null = null;
					state.doc.forEach((node, pos) => {
						if (node.type.name !== SECTION_NODE) return;
						const uid = node.attrs.blockUid as string | null;
						if (uid && !claimed.has(uid)) {
							claimed.add(uid);
							return;
						}
						const fresh = nextUid();
						claimed.add(fresh);
						tr = (tr ?? state.tr).setNodeMarkup(pos, undefined, {
							...node.attrs,
							blockUid: fresh,
							blockRef: null
						});
					});
					return tr ? (tr as typeof state.tr).setMeta('addToHistory', false) : null;
				}
			})
		];
	}
});
