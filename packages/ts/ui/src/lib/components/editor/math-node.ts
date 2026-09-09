// A formula, as one element of a section: `math` inside a sentence and
// `mathBlock` standing on its own. What is STORED is the TeX somebody typed, so
// the same formula reads the same wherever the note is opened.

import { InputRule, Node, mergeAttributes } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import katex from 'katex';
import { placeBlock, replaceBlock } from './placement.js';

export const MATH_NODE = 'math';
export const MATH_BLOCK_NODE = 'mathBlock';

/** A formula whose TeX this build cannot read is carried untouched rather than
 *  opened into a node view that would draw nothing. */
export function readsAsMath(attrs: unknown): boolean {
	if (attrs === null || typeof attrs !== 'object') return false;
	return typeof (attrs as { tex?: unknown }).tex === 'string';
}

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		math: {
			insertMathBlock: (tex?: string) => ReturnType;
		};
	}
}

const NOT_DRAWN = "This formula didn't come out.";

/** Draws `tex` into `drawn`; answers with what to tell the writer where it would
 *  not draw, and with nothing where it did. */
export function drawMath(tex: string, display: boolean, drawn: HTMLElement): string {
	drawn.textContent = '';
	if (!tex.trim()) return '';
	try {
		katex.render(tex, drawn, { displayMode: display, throwOnError: true });
		return '';
	} catch (error) {
		drawn.textContent = '';
		// KaTeX names itself and the place in the formula; the place is the half a
		// writer can do something about.
		const said = error instanceof Error ? error.message.replace(/^KaTeX parse error:\s*/, '') : '';
		return said ? `${NOT_DRAWN} ${said}` : NOT_DRAWN;
	}
}

interface Shape {
	name: string;
	display: boolean;
	/** How the source is typed: one line inside a sentence, several standing
	 *  alone. */
	source: 'input' | 'textarea';
}

/** Either field the source is typed into, as the writing surface uses it. */
type SourceField = HTMLElement & {
	value: string;
	placeholder: string;
	setSelectionRange: (from: number, to: number) => void;
};

function MathKind(shape: Shape) {
	return Node.create({
		name: shape.name,
		group: shape.display ? 'block' : 'inline',
		inline: !shape.display,
		atom: true,
		selectable: true,
		draggable: false,

		addAttributes() {
			return {
				tex: {
					default: '',
					parseHTML: (el) => el.getAttribute('data-tex') ?? '',
					renderHTML: (attrs) => ({ 'data-tex': attrs.tex })
				}
			};
		},

		parseHTML() {
			return [{ tag: `${shape.display ? 'div' : 'span'}[data-tex]` }];
		},

		renderHTML({ HTMLAttributes }) {
			return [shape.display ? 'div' : 'span', mergeAttributes(HTMLAttributes)];
		},

		renderText({ node }) {
			const tex = (node.attrs.tex as string) ?? '';
			return shape.display ? `$$\n${tex}\n$$` : `$${tex}$`;
		},

		addNodeView() {
			return ({ node, editor, getPos }) => {
				let current = node;

				const dom = document.createElement(shape.display ? 'div' : 'span');
				dom.className = shape.display ? 'sloppy-math-block' : 'sloppy-math';
				dom.setAttribute('contenteditable', 'false');

				const drawn = document.createElement(shape.display ? 'div' : 'span');
				drawn.className = 'sloppy-math-drawn';
				const trouble = document.createElement(shape.display ? 'p' : 'span');
				trouble.className = 'sloppy-math-trouble';
				dom.append(drawn, trouble);

				const at = (): number | undefined => {
					const pos = typeof getPos === 'function' ? getPos() : undefined;
					return typeof pos === 'number' ? pos : undefined;
				};

				let source: SourceField | null = null;
				if (editor.isEditable) {
					source = document.createElement(shape.source);
					source.className = 'sloppy-math-source';
					source.placeholder = 'Write the formula';
					source.setAttribute('aria-label', 'Formula');
					source.value = (current.attrs.tex as string) ?? '';
					dom.append(source);

					const field = source;
					field.addEventListener('input', () => write(field.value));
					field.addEventListener('keydown', (event) => {
						if (event.key !== 'Escape' && (event.key !== 'Enter' || event.shiftKey)) return;
						event.preventDefault();
						// The sheet's escape layer does not consult `defaultPrevented`, so an
						// un-stopped Escape closes the note the formula is being written in.
						event.stopPropagation();
						editor.commands.focus();
					});
					field.addEventListener('blur', () => dom.classList.remove('is-writing'));
					// A formula in a sentence keeps its line to itself until somebody
					// asks to write in it.
					drawn.addEventListener('click', () => {
						const pos = at();
						if (pos !== undefined) editor.commands.setNodeSelection(pos);
					});
				}

				function write(tex: string): void {
					if (editor.isDestroyed) return;
					const pos = at();
					if (pos === undefined) return;
					editor.view.dispatch(
						editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, tex })
					);
				}

				function redraw(): void {
					const tex = (current.attrs.tex as string) ?? '';
					const said = drawMath(tex, shape.display, drawn);
					trouble.textContent = said;
					dom.classList.toggle('has-trouble', said !== '');
					dom.classList.toggle('is-blank', tex.trim() === '');
				}

				redraw();

				return {
					dom,
					update: (updated) => {
						if (updated.type.name !== shape.name) return false;
						current = updated;
						const tex = (current.attrs.tex as string) ?? '';
						if (source && source.value !== tex) source.value = tex;
						redraw();
						return true;
					},
					selectNode: () => {
						dom.classList.add('is-selected', 'is-writing');
						if (!source) return;
						source.focus();
						const end = source.value.length;
						source.setSelectionRange(end, end);
					},
					deselectNode: () => dom.classList.remove('is-selected'),
					stopEvent: () => true,
					ignoreMutation: () => true
				};
			};
		},

		addCommands() {
			if (!shape.display) return {};
			return {
				insertMathBlock:
					(tex = '') =>
					({ chain, state }) => {
						const { at, content } = placeBlock(state, { type: this.name, attrs: { tex } });
						return chain().insertContentAt(at, content).setNodeSelection(at).run();
					}
			};
		},

		addInputRules() {
			// `$$` opens a formula standing on its own, so it is written into the
			// node that replaces the line; `$…$` closes one already typed.
			if (shape.display) {
				return [
					new InputRule({
						find: /^\$\$$/,
						handler: ({ state, range }) => {
							const at = replaceBlock(state.tr, range, this.type.create());
							if (at === null) return null;
							state.tr.setSelection(NodeSelection.create(state.tr.doc, at));
							return undefined;
						}
					})
				];
			}
			// The TeX may not open or close on a space, so two prices in one
			// sentence stay two prices.
			return [
				new InputRule({
					find: /\$([^$\n\s](?:[^$\n]*[^$\n\s])?)\$$/,
					handler: ({ state, range, match }) => {
						// A dollar already in front makes this the tail of `$$…$$`. Read
						// back rather than using a lookbehind: Safari gained those in 16.4
						// and the app supports iOS 16.0, where the literal throws at parse
						// and takes the note surface with it.
						if (state.doc.textBetween(Math.max(0, range.from - 1), range.from) === '$') return null;
						state.tr.replaceWith(range.from, range.to, this.type.create({ tex: match[1] }));
						return undefined;
					}
				})
			];
		}
	});
}

export const MathNode = MathKind({ name: MATH_NODE, display: false, source: 'input' });
export const MathBlockNode = MathKind({ name: MATH_BLOCK_NODE, display: true, source: 'textarea' });
