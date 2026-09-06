// A picture in a note, as one element of a section. What is STORED is the
// upload it came from and never an address: a note is private until its subtree
// is published and so is its picture, so where one draws from is asked per
// reader — docs/ARCHITECTURE.md § "Pictures".
//
// While the bytes are still going the node holds the file itself, so the
// picture is on the page from the moment it is chosen.

import type { DocumentNode } from '@sloppy/types';
import { Node, mergeAttributes } from '@tiptap/core';
import type { NoteMedia, ShownPicture } from './contract.js';
import { placeBlock } from './placement.js';

export const PICTURE_NODE = 'picture';

const COULD_NOT_DRAW = "This picture didn't load. Open the note again in a moment.";
/** A picture inside a copy of somebody else's note. Whatever the copy did not
 *  bring is not somewhere the reader can go and get. */
const NOT_HELD = "This picture isn't readable here.";

/**
 * How a picture is written into a section's document: the upload, and what it
 * takes to lay the page out. Null while the bytes are still on their way, so a
 * note is never stored pointing at bytes that never arrived.
 */
export function storedPicture(node: DocumentNode): DocumentNode | null {
	const attrs = node.attrs ?? {};
	if (typeof attrs.upload_id !== 'string' || !attrs.upload_id) return null;
	const size = (value: unknown) =>
		typeof value === 'number' && value > 0 ? Math.round(value) : undefined;
	return {
		type: node.type,
		attrs: {
			upload_id: attrs.upload_id,
			...(size(attrs.width) ? { width: size(attrs.width) } : {}),
			...(size(attrs.height) ? { height: size(attrs.height) } : {}),
			...(typeof attrs.alt === 'string' && attrs.alt ? { alt: attrs.alt } : {})
		}
	};
}

export interface PictureInsert {
	/** Absent while the bytes are still going; {@link preview} draws until then. */
	upload_id?: string | null;
	alt?: string;
	width?: number | null;
	height?: number | null;
	/** An object URL for the file itself, which the node owns from here: it
	 *  revokes it once the picture draws from its upload instead, and when the
	 *  node goes. A caller must not revoke it or use it anywhere else. */
	preview?: string | null;
}

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		picture: {
			insertPicture: (entry: PictureInsert) => ReturnType;
		};
	}
}

function quietButton(label: string): HTMLButtonElement {
	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'sloppy-picture-action';
	button.textContent = label;
	return button;
}

function numberAttr(value: string | null): number | null {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Only what a picture on the page needs, so a surface that reads without
 *  writing has nothing to send from. `held` marks a copy of somebody else's
 *  note: a picture that does not draw there will not draw later either. */
export type PictureSource = Pick<NoteMedia, 'picture'> & { held?: boolean };

export function PictureNode(media: () => PictureSource | undefined) {
	return Node.create({
		name: PICTURE_NODE,
		group: 'block',
		atom: true,
		selectable: true,
		draggable: false,

		addAttributes() {
			return {
				upload_id: {
					default: null,
					parseHTML: (el) => el.getAttribute('data-upload'),
					renderHTML: (attrs) => (attrs.upload_id ? { 'data-upload': attrs.upload_id } : {})
				},
				alt: {
					default: '',
					parseHTML: (el) => el.getAttribute('data-alt') ?? '',
					renderHTML: (attrs) => (attrs.alt ? { 'data-alt': attrs.alt } : {})
				},
				width: {
					default: null,
					parseHTML: (el) => numberAttr(el.getAttribute('data-width')),
					renderHTML: (attrs) => (attrs.width ? { 'data-width': String(attrs.width) } : {})
				},
				height: {
					default: null,
					parseHTML: (el) => numberAttr(el.getAttribute('data-height')),
					renderHTML: (attrs) => (attrs.height ? { 'data-height': String(attrs.height) } : {})
				},
				// The file itself, and how far it has got. Neither outlives the tab,
				// so neither is written into the document's HTML.
				preview: { default: null, rendered: false },
				progress: { default: null, rendered: false },
				/** What to tell the person when the send did not finish. */
				failure: { default: null, rendered: false }
			};
		},

		parseHTML() {
			return [{ tag: 'div[data-picture]' }];
		},

		renderHTML({ HTMLAttributes }) {
			return ['div', mergeAttributes(HTMLAttributes, { 'data-picture': 'true' })];
		},

		renderText() {
			return '';
		},

		addNodeView() {
			return ({ node, editor, getPos }) => {
				let current = node;
				let shown: ShownPicture | null = null;
				let drawn: string | null = null;
				let held: string | null = null;

				const dom = document.createElement('div');
				dom.className = 'sloppy-picture';
				dom.setAttribute('data-picture-block', 'true');
				dom.setAttribute('contenteditable', 'false');

				const frame = document.createElement('div');
				frame.className = 'sloppy-picture-frame';
				const image = document.createElement('img');
				image.className = 'sloppy-picture-image';
				image.draggable = false;
				const note = document.createElement('p');
				note.className = 'sloppy-picture-note';
				const meter = document.createElement('div');
				meter.className = 'sloppy-picture-meter';
				const filled = document.createElement('span');
				meter.append(filled);
				frame.append(image, note, meter);

				dom.append(frame);

				let description: HTMLInputElement | null = null;
				if (editor.isEditable) {
					const bar = document.createElement('div');
					bar.className = 'sloppy-picture-bar';
					description = document.createElement('input');
					description.type = 'text';
					description.className = 'sloppy-picture-description';
					description.placeholder = 'Describe this picture';
					description.setAttribute('aria-label', 'Describe this picture');
					const remove = quietButton('Remove picture');
					bar.append(description, remove);
					dom.append(bar);

					const field = description;
					field.addEventListener('input', () => apply({ alt: field.value }));

					remove.addEventListener('click', (event) => {
						event.preventDefault();
						if (editor.isDestroyed) return;
						const at = positionOf();
						if (at === undefined) return;
						editor.commands.deleteRange({ from: at, to: at + current.nodeSize });
					});
				}

				function positionOf(): number | undefined {
					const at = typeof getPos === 'function' ? getPos() : undefined;
					return typeof at === 'number' ? at : undefined;
				}

				function apply(attrs: Record<string, unknown>): void {
					if (editor.isDestroyed) return;
					const at = positionOf();
					if (at === undefined) return;
					editor.view.dispatch(
						editor.state.tr.setNodeMarkup(at, undefined, { ...current.attrs, ...attrs })
					);
				}

				function free(): void {
					shown?.release();
					shown = null;
				}

				function drop(): void {
					if (held) URL.revokeObjectURL(held);
					held = null;
				}

				/** The address is asked for once per upload, and only for the owner. */
				async function draw(): Promise<void> {
					const uploadId = current.attrs.upload_id as string | null;
					const preview = current.attrs.preview as string | null;
					const wanted = uploadId ?? preview;
					if (drawn === wanted) return;
					drawn = wanted;
					if (preview && !uploadId) {
						free();
						held = preview;
						image.src = preview;
						return;
					}
					if (!uploadId) {
						free();
						drop();
						image.removeAttribute('src');
						return;
					}
					const ask = media()?.picture(uploadId);
					if (!ask) return;
					try {
						const picture = await ask;
						if (drawn !== wanted) {
							picture.release();
							return;
						}
						free();
						shown = picture;
						image.src = picture.src;
						drop();
						note.textContent = '';
					} catch {
						if (drawn !== wanted) return;
						note.textContent = media()?.held ? NOT_HELD : COULD_NOT_DRAW;
					}
				}

				function redraw(): void {
					const width = current.attrs.width as number | null;
					const height = current.attrs.height as number | null;
					image.style.aspectRatio = width && height ? `${width} / ${height}` : '';
					// A small picture is shown at its own size rather than blown up to
					// the width of the note.
					image.style.maxWidth = width ? `${width}px` : '';
					image.alt = (current.attrs.alt as string) || '';
					if (description && description.value !== ((current.attrs.alt as string) || '')) {
						description.value = (current.attrs.alt as string) || '';
					}

					const progress = current.attrs.progress as number | null;
					const sending = progress !== null && !current.attrs.upload_id;
					meter.style.display = sending ? '' : 'none';
					filled.style.width = `${Math.round(Math.min(1, Math.max(0, progress ?? 0)) * 100)}%`;
					dom.classList.toggle('is-sending', sending);

					if (current.attrs.failure) {
						note.textContent = current.attrs.failure as string;
					} else if (sending) {
						note.textContent = '';
					}
					void draw();
				}

				image.addEventListener('error', () => {
					if (current.attrs.upload_id && image.getAttribute('src')) {
						note.textContent = media()?.held ? NOT_HELD : COULD_NOT_DRAW;
					}
				});

				redraw();

				return {
					dom,
					update: (updated) => {
						if (updated.type.name !== PICTURE_NODE) return false;
						current = updated;
						redraw();
						return true;
					},
					selectNode: () => dom.classList.add('is-selected'),
					deselectNode: () => dom.classList.remove('is-selected'),
					destroy: () => {
						free();
						drop();
					},
					stopEvent: () => true,
					ignoreMutation: () => true
				};
			};
		},

		addCommands() {
			return {
				insertPicture:
					(entry: PictureInsert) =>
					({ commands, state }) => {
						const { at, content } = placeBlock(state, {
							type: this.name,
							attrs: {
								upload_id: entry.upload_id ?? null,
								alt: entry.alt ?? '',
								width: entry.width ?? null,
								height: entry.height ?? null,
								preview: entry.preview ?? null,
								progress: entry.upload_id ? null : 0,
								failure: null
							}
						});
						return commands.insertContentAt(at, content);
					}
			};
		}
	});
}
