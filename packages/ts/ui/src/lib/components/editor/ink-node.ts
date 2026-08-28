// The drawing that lives in a note as one more block. Its record is the strokes
// (`InkBlockData` in @sloppy/types); this node holds them and draws them.
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

const markdownSpec = {
	markdownName: 'ink',
	renderMarkdown: (): string => ''
} as Record<string, unknown>;

const GROWTH_MARGIN = 24;

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
	name: 'ink',
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
			rasterUploadId: { default: null, rendered: false }
		};
	},

	parseHTML() {
		return [{ tag: 'div[data-ink]' }];
	},

	renderHTML({ HTMLAttributes }) {
		return ['div', mergeAttributes(HTMLAttributes, { 'data-ink': 'true' })];
	},

	renderText() {
		return '';
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
			const bar = document.createElement('div');
			bar.className = 'sloppy-ink-bar';
			const undoStroke = quietButton('Undo stroke');
			const removeDrawing = quietButton('Remove drawing');
			bar.append(undoStroke, removeDrawing);
			dom.append(canvas, bar);

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
				const prepared = context();
				if (!prepared) return;
				const rect = box();
				prepared.ctx.clearRect(0, 0, rect.width, rect.height);
				drawStrokes(prepared.ctx, strokes(), prepared.scale);
				if (wet) drawStroke(prepared.ctx, { points: wet.points, width: wet.width }, prepared.scale);
				undoStroke.disabled = strokes().length === 0;
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
					if (updated.type.name !== 'ink') return false;
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
	},

	...markdownSpec
});
