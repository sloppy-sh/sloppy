// A note named inside somebody's writing. What is STORED is the reference —
// `<did>/<ulid>`, which outlives every rename — beside the words it was cited
// under, so a note that has since gone still reads as something. The canvas
// draws a line for it: DESIGN.md § Edges is the ruling.

import { noteLabel, type OwnedRef, REFERENCE_NOTE_ATTR } from '@sloppy/types';
import { Node, mergeAttributes } from '@tiptap/core';
import type { NoteReferences } from './contract.js';

export const REFERENCE_NODE = 'reference';

/** The words a note is cited under. Where it has no title, whatever else names
 *  it stands in — `noteLabel` in `@sloppy/types`. */
export function citedAs(note: { address?: string; title: string }): string {
	return note.title || noteLabel(note);
}

/** Only what a reference already in the writing needs, so a surface that reads
 *  without writing has nothing to write a note from. */
export type ReferenceReader = Pick<NoteReferences, 'read' | 'open'>;

export function ReferenceNode(references: () => ReferenceReader | undefined) {
	return Node.create({
		name: REFERENCE_NODE,
		group: 'inline',
		inline: true,
		atom: true,
		selectable: false,
		draggable: false,

		addAttributes() {
			return {
				[REFERENCE_NOTE_ATTR]: {
					default: '',
					parseHTML: (el) => el.getAttribute('data-note') ?? '',
					renderHTML: (attrs) => ({ 'data-note': attrs[REFERENCE_NOTE_ATTR] })
				},
				label: {
					default: '',
					parseHTML: (el) => el.getAttribute('data-label') ?? el.textContent ?? '',
					renderHTML: (attrs) => ({ 'data-label': attrs.label })
				}
			};
		},

		parseHTML() {
			return [{ tag: 'a[data-note]' }];
		},

		renderHTML({ node, HTMLAttributes }) {
			return [
				'a',
				mergeAttributes(HTMLAttributes, { class: 'sloppy-reference' }),
				node.attrs.label as string
			];
		},

		renderText({ node }) {
			return `[[${node.attrs.label}]]`;
		},

		addNodeView() {
			return ({ node }) => {
				let current = node;
				/** The note this has asked after, so one answer is asked for once. */
				let asked: string | null = null;
				/** What the note says now, once it has said anything. */
				let standing: { label: string; gone: boolean } | null = null;

				const dom = document.createElement('a');
				dom.className = 'sloppy-reference';
				dom.setAttribute('contenteditable', 'false');
				dom.setAttribute('role', 'link');
				dom.tabIndex = 0;

				function draw(): void {
					const shown = standing ?? { label: current.attrs.label as string, gone: false };
					dom.textContent = shown.label;
					dom.classList.toggle('is-gone', shown.gone);
					dom.setAttribute(
						'aria-label',
						shown.gone ? `${shown.label} — this note is no longer here` : shown.label
					);
				}

				/** A note is renamed after it is cited, so what it says now wins over
				 *  what it said then. */
				async function resolve(): Promise<void> {
					const note = current.attrs[REFERENCE_NOTE_ATTR] as string;
					if (!note || asked === note) return;
					asked = note;
					try {
						const found = await references()?.read(note as OwnedRef);
						if (asked !== note) return;
						standing = found
							? { label: citedAs(found), gone: false }
							: { label: current.attrs.label as string, gone: true };
						draw();
					} catch {
						// A lookup that failed says nothing about whether the note is there.
					}
				}

				function open(event: Event): void {
					event.preventDefault();
					const note = current.attrs[REFERENCE_NOTE_ATTR] as string;
					if (!note || standing?.gone) return;
					references()?.open(note as OwnedRef);
				}

				// The caret stays where it was: a reference nobody can follow must not
				// cost the writer their place in the sentence.
				dom.addEventListener('mousedown', (event) => event.preventDefault());
				dom.addEventListener('click', open);
				dom.addEventListener('keydown', (event) => {
					if (event.key === 'Enter' || event.key === ' ') open(event);
				});

				draw();
				void resolve();

				return {
					dom,
					update: (updated) => {
						if (updated.type.name !== REFERENCE_NODE) return false;
						if (updated.attrs[REFERENCE_NOTE_ATTR] !== current.attrs[REFERENCE_NOTE_ATTR])
							standing = null;
						current = updated;
						draw();
						void resolve();
						return true;
					},
					stopEvent: () => true,
					ignoreMutation: () => true
				};
			};
		}
	});
}
