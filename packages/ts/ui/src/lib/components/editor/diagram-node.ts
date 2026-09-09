// A diagram, as one element of a section. What is STORED is the language and
// the source somebody wrote — never the picture drawn from it — so a build that
// draws a language this one does not still carries the diagram whole.

import { InputRule, Node, mergeAttributes } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import {
	DIAGRAM_LANGUAGES,
	MERMAID,
	drawDiagram,
	drawsDiagrams,
	whenThemeChanges
} from './diagrams.js';
import { placeBlock, replaceBlock } from './placement.js';

export const DIAGRAM_NODE = 'diagram';

/** A diagram this build cannot read is carried untouched rather than opened
 *  into a node view that would draw nothing. */
export function readsAsDiagram(attrs: unknown): boolean {
	if (attrs === null || typeof attrs !== 'object') return false;
	const held = attrs as { language?: unknown; source?: unknown };
	return typeof held.language === 'string' && typeof held.source === 'string';
}

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		diagram: {
			insertDiagram: (entry?: { language?: string; source?: string }) => ReturnType;
		};
	}
}

const NOT_DRAWN = "This diagram didn't come out.";
/** A language this build has no renderer for; the source is shown instead. */
const NOT_DRAWN_HERE = "This kind of diagram isn't drawn here.";

/** How long the writing rests before the diagram is drawn again. */
const SETTLE_AFTER_MS = 400;

/** Mermaid names the SVG it draws, and no two on a page may share a name. */
let named = 0;

export const DiagramNode = Node.create({
	name: DIAGRAM_NODE,
	group: 'block',
	atom: true,
	selectable: true,
	draggable: false,
	// Above the code block, whose own rule would take a ``` fence first.
	priority: 1000,

	addAttributes() {
		return {
			language: {
				default: MERMAID,
				parseHTML: (el) => el.getAttribute('data-language') ?? MERMAID,
				renderHTML: (attrs) => ({ 'data-language': attrs.language })
			},
			source: {
				default: '',
				parseHTML: (el) => el.getAttribute('data-source') ?? '',
				renderHTML: (attrs) => ({ 'data-source': attrs.source })
			}
		};
	},

	parseHTML() {
		return [{ tag: 'div[data-diagram]' }];
	},

	renderHTML({ HTMLAttributes }) {
		return ['div', mergeAttributes(HTMLAttributes, { 'data-diagram': 'true' })];
	},

	renderText({ node }) {
		return `\`\`\`${node.attrs.language as string}\n${node.attrs.source as string}\n\`\`\``;
	},

	addNodeView() {
		return ({ node, editor, getPos }) => {
			let current = node;
			/** Which draw the picture on screen belongs to, so a slow one that has
			 *  been overtaken drops its result. */
			let drawing = 0;
			let settling: ReturnType<typeof setTimeout> | undefined;

			const dom = document.createElement('div');
			dom.className = 'sloppy-diagram';
			dom.setAttribute('data-diagram-block', 'true');
			dom.setAttribute('contenteditable', 'false');

			const picture = document.createElement('div');
			picture.className = 'sloppy-diagram-drawn';
			const trouble = document.createElement('p');
			trouble.className = 'sloppy-diagram-trouble';
			dom.append(picture, trouble);

			const at = (): number | undefined => {
				const pos = typeof getPos === 'function' ? getPos() : undefined;
				return typeof pos === 'number' ? pos : undefined;
			};

			let source: HTMLTextAreaElement | null = null;
			if (editor.isEditable) {
				source = document.createElement('textarea');
				source.className = 'sloppy-diagram-source';
				source.placeholder = 'Write the diagram';
				source.setAttribute('aria-label', 'Diagram');
				source.value = (current.attrs.source as string) ?? '';
				dom.append(source);

				const field = source;
				field.addEventListener('input', () => write(field.value));
				field.addEventListener('keydown', (event) => {
					if (event.key !== 'Escape') return;
					event.preventDefault();
					// The sheet's escape layer does not consult `defaultPrevented`, so an
					// un-stopped Escape closes the note the diagram is being written in.
					event.stopPropagation();
					editor.commands.focus();
				});
			}

			function write(next: string): void {
				if (editor.isDestroyed) return;
				const pos = at();
				if (pos === undefined) return;
				editor.view.dispatch(
					editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, source: next })
				);
			}

			function fits(field: HTMLTextAreaElement): void {
				field.rows = Math.min(16, Math.max(3, field.value.split('\n').length));
			}

			async function draw(): Promise<void> {
				const language = (current.attrs.language as string) ?? '';
				const written = ((current.attrs.source as string) ?? '').trim();
				const mine = ++drawing;
				dom.classList.toggle('is-blank', written === '');
				if (written === '') {
					picture.textContent = '';
					picture.classList.remove('is-plain');
					trouble.textContent = '';
					return;
				}
				if (!drawsDiagrams(language)) {
					picture.textContent = written;
					picture.classList.add('is-plain');
					trouble.textContent = NOT_DRAWN_HERE;
					return;
				}
				try {
					const svg = await drawDiagram(language, written, `sloppy-diagram-${++named}`);
					if (mine !== drawing) return;
					picture.classList.remove('is-plain');
					picture.innerHTML = svg;
					trouble.textContent = '';
				} catch (error) {
					if (mine !== drawing) return;
					picture.textContent = '';
					picture.classList.remove('is-plain');
					const said = error instanceof Error ? error.message.split('\n')[0] : '';
					trouble.textContent = said ? `${NOT_DRAWN} ${said}` : NOT_DRAWN;
				}
			}

			function redraw(soon: boolean): void {
				clearTimeout(settling);
				if (source) fits(source);
				if (!soon) {
					void draw();
					return;
				}
				settling = setTimeout(() => void draw(), SETTLE_AFTER_MS);
			}

			redraw(false);
			const forget = whenThemeChanges(() => redraw(false));

			return {
				dom,
				update: (updated) => {
					if (updated.type.name !== DIAGRAM_NODE) return false;
					const was = current.attrs.source as string;
					current = updated;
					const written = (current.attrs.source as string) ?? '';
					if (source && source.value !== written) source.value = written;
					redraw(was !== written);
					return true;
				},
				selectNode: () => {
					dom.classList.add('is-selected');
					source?.focus();
					source?.setSelectionRange(source.value.length, source.value.length);
				},
				deselectNode: () => dom.classList.remove('is-selected'),
				destroy: () => {
					clearTimeout(settling);
					forget();
				},
				stopEvent: () => true,
				ignoreMutation: () => true
			};
		};
	},

	addCommands() {
		return {
			insertDiagram:
				(entry = {}) =>
				({ chain, state }) => {
					const { at, content } = placeBlock(state, {
						type: this.name,
						attrs: { language: entry.language ?? MERMAID, source: entry.source ?? '' }
					});
					return chain().insertContentAt(at, content).setNodeSelection(at).run();
				}
		};
	},

	addInputRules() {
		return [
			new InputRule({
				find: new RegExp(`^\`\`\`(${DIAGRAM_LANGUAGES.join('|')})[\\s\\n]$`),
				handler: ({ state, range, match }) => {
					const opened = this.type.create({ language: match[1], source: '' });
					const at = replaceBlock(state.tr, range, opened);
					if (at === null) return null;
					state.tr.setSelection(NodeSelection.create(state.tr.doc, at));
					return undefined;
				}
			})
		];
	}
});
