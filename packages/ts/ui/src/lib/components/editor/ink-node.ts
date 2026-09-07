// A drawing, as one element of a section. Its record is the strokes
// (`InkElementData` in @sloppy/types, which is what these attributes are); this
// node holds them and draws them.
//
// Touch is left alone so the page still pans under a drawing — DESIGN.md
// § The canvas.

import type { InkStroke } from '@sloppy/types';
import { Node, mergeAttributes } from '@tiptap/core';
import {
	NIB_WIDTH,
	StrokeInProgress,
	capturePointer,
	drawStroke,
	drawStrokes,
	prepareCanvas,
	strokeBounds
} from './ink.js';
import { placeBlock } from './placement.js';

export const INK_NODE = 'ink';

export interface InkInsert {
	width: number;
	height: number;
	strokes?: InkStroke[];
}

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		ink: {
			insertInk: (entry: InkInsert) => ReturnType;
		};
	}
}

const GROWTH_MARGIN = 24;
/** What a drawing nobody has described is announced as. */
const UNDESCRIBED = 'Drawing';

function readJson<T>(raw: string | null, fallback: T): T {
	if (!raw) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

function quietButton(label: string): HTMLButtonElement {
	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'sloppy-ink-action';
	button.textContent = label;
	return button;
}

export const InkNode = Node.create({
	name: INK_NODE,
	group: 'block',
	atom: true,
	selectable: true,
	draggable: false,

	addAttributes() {
		return {
			strokes: {
				default: [] as InkStroke[],
				parseHTML: (el) => readJson<InkStroke[]>(el.getAttribute('data-strokes'), []),
				renderHTML: (attrs) => ({ 'data-strokes': JSON.stringify(attrs.strokes ?? []) })
			},
			width: {
				default: 600,
				parseHTML: (el) => Number(el.getAttribute('data-width')) || 600,
				renderHTML: (attrs) => ({ 'data-width': String(attrs.width) })
			},
			height: {
				default: 200,
				parseHTML: (el) => Number(el.getAttribute('data-height')) || 200,
				renderHTML: (attrs) => ({ 'data-height': String(attrs.height) })
			},
			raster_upload_id: { default: null, rendered: false },
			description: {
				default: null,
				parseHTML: (el) => el.getAttribute('data-description'),
				renderHTML: (attrs) => (attrs.description ? { 'data-description': attrs.description } : {})
			}
		};
	},

	parseHTML() {
		return [{ tag: 'div[data-ink]' }];
	},

	renderHTML({ HTMLAttributes }) {
		return ['div', mergeAttributes(HTMLAttributes, { 'data-ink': 'true' })];
	},

	renderText({ node }) {
		return (node.attrs.description as string | null) ?? '';
	},

	addNodeView() {
		return ({ node, editor, getPos }) => {
			let current = node;
			let wet: StrokeInProgress | null = null;

			const dom = document.createElement('div');
			dom.className = 'sloppy-ink';
			dom.setAttribute('data-ink-block', 'true');
			dom.setAttribute('contenteditable', 'false');

			const canvas = document.createElement('canvas');
			canvas.className = 'sloppy-ink-canvas';
			canvas.setAttribute('role', 'img');
			dom.append(canvas);

			let undoStroke: HTMLButtonElement | null = null;
			let description: HTMLInputElement | null = null;
			if (editor.isEditable) {
				const bar = document.createElement('div');
				bar.className = 'sloppy-ink-bar';
				description = document.createElement('input');
				description.type = 'text';
				description.className = 'sloppy-ink-description';
				description.placeholder = 'Describe this drawing';
				description.setAttribute('aria-label', 'Describe this drawing');
				undoStroke = quietButton('Undo stroke');
				const removeDrawing = quietButton('Remove drawing');
				bar.append(description, undoStroke, removeDrawing);
				dom.append(bar);

				const field = description;
				field.addEventListener('input', () => apply({ description: field.value || null }));

				undoStroke.addEventListener('click', (event) => {
					event.preventDefault();
					apply({ strokes: strokes().slice(0, -1) });
				});

				removeDrawing.addEventListener('click', (event) => {
					event.preventDefault();
					if (editor.isDestroyed) return;
					const at = positionOf();
					if (at === undefined) return;
					editor.commands.deleteRange({ from: at, to: at + current.nodeSize });
				});
			}

			const box = () => canvas.getBoundingClientRect();
			const strokes = (): InkStroke[] => (current.attrs.strokes as InkStroke[]) ?? [];
			const ink = () => getComputedStyle(dom).color;

			function context(): { ctx: CanvasRenderingContext2D; scale: number } | null {
				const rect = box();
				if (rect.width === 0) return null;
				const ctx = prepareCanvas(canvas, rect.width, rect.height);
				if (!ctx) return null;
				ctx.strokeStyle = ink();
				ctx.fillStyle = ctx.strokeStyle;
				return { ctx, scale: rect.width / (current.attrs.width as number) };
			}

			function redraw(): void {
				canvas.style.aspectRatio = `${current.attrs.width} / ${current.attrs.height}`;
				const said = (current.attrs.description as string | null) ?? '';
				canvas.setAttribute('aria-label', said || UNDESCRIBED);
				if (description && description.value !== said) description.value = said;
				const prepared = context();
				if (!prepared) return;
				const rect = box();
				prepared.ctx.clearRect(0, 0, rect.width, rect.height);
				drawStrokes(prepared.ctx, strokes(), prepared.scale);
				if (wet) drawStroke(prepared.ctx, { points: wet.points, width: wet.width }, prepared.scale);
				if (undoStroke) undoStroke.disabled = strokes().length === 0;
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

			function surface() {
				const rect = box();
				return {
					left: rect.left,
					top: rect.top,
					scale: (current.attrs.width as number) / rect.width
				};
			}

			// A drawing surface draws under any pointer that is not a finger; a finger
			// is how the page is scrolled past it.
			canvas.addEventListener('pointerdown', (event) => {
				if (event.pointerType === 'touch' || !editor.isEditable) return;
				event.preventDefault();
				capturePointer(canvas, event.pointerId);
				wet = new StrokeInProgress(event, surface(), NIB_WIDTH);
				redraw();
			});

			canvas.addEventListener('pointermove', (event) => {
				if (!wet) return;
				event.preventDefault();
				const before = wet.points.length;
				wet.extend(event, surface());
				const prepared = context();
				if (prepared) {
					drawStroke(
						prepared.ctx,
						{ points: wet.points, width: wet.width },
						prepared.scale,
						Math.max(1, before)
					);
				}
			});

			function settle(): void {
				const stroke = wet?.finish();
				wet = null;
				if (!stroke) {
					redraw();
					return;
				}
				const bounds = strokeBounds([stroke]);
				const height = Math.max(
					current.attrs.height as number,
					bounds ? Math.ceil(bounds.bottom + GROWTH_MARGIN) : 0
				);
				apply({ strokes: [...strokes(), stroke], height });
			}

			canvas.addEventListener('pointerup', settle);
			canvas.addEventListener('pointercancel', settle);

			const resize = new ResizeObserver(() => redraw());
			resize.observe(canvas);
			// The mark is the theme's foreground, so a theme switch is a repaint.
			const theme = new MutationObserver(() => redraw());
			theme.observe(document.documentElement, {
				attributes: true,
				attributeFilter: ['data-theme', 'class', 'style']
			});

			redraw();

			return {
				dom,
				update: (updated) => {
					if (updated.type.name !== INK_NODE) return false;
					current = updated;
					redraw();
					return true;
				},
				selectNode: () => dom.classList.add('is-selected'),
				deselectNode: () => dom.classList.remove('is-selected'),
				destroy: () => {
					resize.disconnect();
					theme.disconnect();
				},
				stopEvent: () => true,
				ignoreMutation: () => true
			};
		};
	},

	addCommands() {
		return {
			insertInk:
				(entry: InkInsert) =>
				({ commands, state }) => {
					const { at, content } = placeBlock(state, {
						type: this.name,
						attrs: { width: entry.width, height: entry.height, strokes: entry.strokes ?? [] }
					});
					return commands.insertContentAt(at, content);
				}
		};
	}
});
