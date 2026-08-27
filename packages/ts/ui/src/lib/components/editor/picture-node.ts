// A picture in a note, as one more block. What is STORED is the upload it came
// from and never an address: a note is private until its subtree is published
// and so is its picture, so where one draws from is asked per reader —
// docs/ARCHITECTURE.md § "Pictures".
//
// While the bytes are still going the node holds the file itself, so the
// picture is on the page from the moment it is chosen. `docBlocks` in
// `./document.ts` is what keeps such a node out of the stack until it has an
// upload to name.

import { Node, mergeAttributes } from '@tiptap/core';
import type { NoteMedia, ShownPicture } from './contract.js';

export const PICTURE_NODE = 'picture';

/** The payload of a block whose type is `image`; `@sloppy/types`' `block.ts`
 *  says how a type-specific payload attaches. */
export interface PictureBlockData {
	upload_id: string;
	width?: number;
	height?: number;
	alt?: string;
}

/** Undefined for a payload that names no upload, which is not a picture yet. */
export function pictureDataFrom(data: unknown): PictureBlockData | undefined {
	if (typeof data !== 'object' || data === null) return undefined;
	const row = data as Record<string, unknown>;
	if (typeof row.upload_id !== 'string' || !row.upload_id) return undefined;
	const size = (value: unknown) =>
		typeof value === 'number' && value > 0 ? Math.round(value) : undefined;
	return {
		upload_id: row.upload_id,
		...(size(row.width) ? { width: size(row.width) } : {}),
		...(size(row.height) ? { height: size(row.height) } : {}),
		...(typeof row.alt === 'string' && row.alt ? { alt: row.alt } : {})
	};
}

export interface PictureInsert {
	/** Absent while the bytes are still going; {@link preview} draws until then. */
	uploadId?: string | null;
	alt?: string;
	width?: number | null;
	height?: number | null;
	preview?: string | null;
}

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		picture: {
			insertPicture: (entry: PictureInsert) => ReturnType;
		};
	}
}

const markdownSpec = {
	markdownName: PICTURE_NODE,
	renderMarkdown: (): string => ''
} as Record<string, unknown>;

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

export function PictureNode(media: () => NoteMedia | undefined) {
	return Node.create({
		name: PICTURE_NODE,
		group: 'block',
		atom: true,
		selectable: true,
		draggable: false,

		addAttributes() {
			return {
				uploadId: {
					default: null,
					parseHTML: (el) => el.getAttribute('data-upload'),
					renderHTML: (attrs) => (attrs.uploadId ? { 'data-upload': attrs.uploadId } : {})
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

				const bar = document.createElement('div');
				bar.className = 'sloppy-picture-bar';
				const description = document.createElement('input');
				description.type = 'text';
				description.className = 'sloppy-picture-description';
				description.placeholder = 'Describe this picture';
				description.setAttribute('aria-label', 'Describe this picture');
				const remove = quietButton('Remove picture');
				bar.append(description, remove);
				dom.append(frame, bar);

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

				/** The address is asked for once per upload, and only for the owner. */
				async function draw(): Promise<void> {
					const uploadId = current.attrs.uploadId as string | null;
					const preview = current.attrs.preview as string | null;
					const wanted = uploadId ?? preview;
					if (drawn === wanted) return;
					drawn = wanted;
					if (preview && !uploadId) {
						free();
						image.src = preview;
						return;
					}
					if (!uploadId) {
						free();
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
						note.textContent = '';
					} catch {
						if (drawn !== wanted) return;
						note.textContent = "This picture didn't load. Open the note again in a moment.";
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
					if (description.value !== ((current.attrs.alt as string) || '')) {
						description.value = (current.attrs.alt as string) || '';
					}

					const progress = current.attrs.progress as number | null;
					const sending = progress !== null && !current.attrs.uploadId;
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

				description.addEventListener('input', () => apply({ alt: description.value }));

				remove.addEventListener('click', (event) => {
					event.preventDefault();
					if (editor.isDestroyed) return;
					const at = positionOf();
					if (at === undefined) return;
					editor.commands.deleteRange({ from: at, to: at + current.nodeSize });
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
					destroy: () => free(),
					stopEvent: () => true,
					ignoreMutation: () => true
				};
			};
		},

		addCommands() {
			return {
				insertPicture:
					(entry: PictureInsert) =>
					({ commands }) =>
						commands.insertContent({
							type: this.name,
							attrs: {
								uploadId: entry.uploadId ?? null,
								alt: entry.alt ?? '',
								width: entry.width ?? null,
								height: entry.height ?? null,
								preview: entry.preview ?? null,
								progress: entry.uploadId ? null : 0,
								failure: null
							}
						})
			};
		},

		...markdownSpec
	});
}
