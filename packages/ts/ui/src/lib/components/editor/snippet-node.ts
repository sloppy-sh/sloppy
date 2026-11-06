// Lines of the project's code quoted into a section, with the place they were
// quoted from and where that code stands now — DESIGN.md § "Code quoted into a
// note". What is STORED is `snippetNode` in `@sloppy/types` and nothing else.

import {
	CODE_SNIPPET_TYPE,
	type CodeSnippet,
	type DocumentNode,
	type SnippetPlace,
	type SnippetState,
	snippetInfo,
	snippetNode,
	snippetOf
} from '@sloppy/types';
import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { NoteCode } from './contract.js';
import { colourLines } from './highlight.js';
import { placeBlock } from './placement.js';

export const SNIPPET_NODE = CODE_SNIPPET_TYPE;

/** A quote this build cannot read is carried untouched rather than opened into
 *  a view that would draw nothing. */
export function readsAsSnippet(attrs: unknown): boolean {
	return snippetOf({ type: SNIPPET_NODE, attrs: attrs as Record<string, unknown> }) !== undefined;
}

/** How a quote is written down: ProseMirror has no absent, so a language the
 *  quote has none of is a null until it is written. */
export function storedSnippet(node: DocumentNode): DocumentNode {
	const snippet = snippetOf(node);
	return snippet ? snippetNode(snippet) : node;
}

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		codeSnippet: {
			insertSnippet: (snippet: CodeSnippet) => ReturnType;
		};
	}
}

/** `L12–20`, or `L12` for one line. */
export function linesSaid(place: SnippetPlace): string {
	return place.from === place.to ? `L${place.from}` : `L${place.from}–${place.to}`;
}

/** What a quote's state says to the person reading the note. Silence is the
 *  ordinary state of a quote whose code still reads this way, and of one this
 *  build cannot tell about. */
export function stateSaid(snippet: SnippetPlace, held: SnippetState): string {
	switch (held.state) {
		case 'moved':
			return held.now.path === snippet.path
				? `This code has moved to ${linesSaid(held.now)}.`
				: `This code has moved to ${held.now.path} · ${linesSaid(held.now)}.`;
		case 'changed':
			return 'This code has changed since it was quoted. It reads now:';
		case 'removed':
			return 'This code is not in the project now.';
		default:
			return '';
	}
}

const REQUOTE = 'Quote it as it is now';

function snippetIn(node: ProseMirrorNode): CodeSnippet | undefined {
	return snippetOf(node.toJSON() as DocumentNode);
}

/** One run of numbered lines, coloured where the language has a grammar. */
function linesView(text: string, first: number, language: string | undefined): HTMLElement {
	const frame = document.createElement('div');
	frame.className = 'sloppy-snippet-lines';
	const code = document.createElement('code');
	frame.append(code);
	const rows = text.split('\n').map((line, at) => {
		const row = document.createElement('span');
		row.className = 'sloppy-snippet-row';
		const number = document.createElement('span');
		number.className = 'sloppy-snippet-number';
		number.setAttribute('aria-hidden', 'true');
		number.textContent = String(first + at);
		const said = document.createElement('span');
		said.className = 'sloppy-snippet-said';
		said.textContent = line;
		row.append(number, said);
		code.append(row);
		return said;
	});
	void colourLines(text, language).then((coloured) => {
		if (!coloured) return;
		coloured.forEach((runs, at) => {
			const said = rows[at];
			if (!said) return;
			said.replaceChildren(
				...runs.map((run) => {
					const span = document.createElement('span');
					span.className = 'shiki';
					span.setAttribute('style', run.style);
					span.textContent = run.text;
					return span;
				})
			);
		});
	});
	return frame;
}

/**
 * The element. `code` is how it reaches the project's files; **absent is a
 * graph with no code beside it**, where a quote is drawn as it was quoted and
 * nothing is worked out about the code under it.
 */
export function SnippetNode(code: () => NoteCode | undefined) {
	return Node.create({
		name: SNIPPET_NODE,
		group: 'block',
		atom: true,
		selectable: true,
		draggable: false,

		addAttributes() {
			const held = (name: string, read: (said: string) => unknown = (said) => said) => ({
				default: null,
				parseHTML: (el: HTMLElement) => {
					const said = el.getAttribute(`data-${name}`);
					return said === null ? null : read(said);
				},
				renderHTML: (attrs: Record<string, unknown>) =>
					attrs[name] === null ? {} : { [`data-${name}`]: String(attrs[name]) }
			});
			return {
				path: held('path'),
				from: held('from', Number),
				to: held('to', Number),
				digest: held('digest'),
				source: held('source'),
				language: held('language')
			};
		},

		parseHTML() {
			return [{ tag: 'div[data-code-snippet]' }];
		},

		renderHTML({ HTMLAttributes }) {
			return ['div', mergeAttributes(HTMLAttributes, { 'data-code-snippet': 'true' })];
		},

		renderText({ node }) {
			const snippet = snippetIn(node);
			if (!snippet) return '';
			return `\`\`\`${snippetInfo(snippet) ?? snippet.language ?? ''}\n${snippet.source}\n\`\`\``;
		},

		addNodeView() {
			return ({ node, editor, getPos }) => {
				let current = node;
				/** Which reading of the code the state on screen belongs to, so a slow
				 *  one that has been overtaken drops its answer. */
				let reading = 0;

				const dom = document.createElement('figure');
				dom.className = 'sloppy-snippet';
				dom.setAttribute('contenteditable', 'false');
				const head = document.createElement('figcaption');
				head.className = 'sloppy-snippet-head';
				const quoted = document.createElement('div');
				const state = document.createElement('div');
				state.className = 'sloppy-snippet-state';
				dom.append(head, quoted, state);

				const at = (): number | undefined => {
					const pos = typeof getPos === 'function' ? getPos() : undefined;
					return typeof pos === 'number' ? pos : undefined;
				};

				function place(snippet: CodeSnippet): void {
					const reaching = code();
					const label = `${snippet.path} · ${linesSaid(snippet)}`;
					if (!reaching) {
						const plain = document.createElement('span');
						plain.className = 'sloppy-snippet-place';
						plain.textContent = label;
						head.replaceChildren(plain);
						return;
					}
					const opens = document.createElement('button');
					opens.type = 'button';
					opens.className = 'sloppy-snippet-place';
					opens.textContent = label;
					opens.addEventListener('click', () =>
						reaching.show({
							path: snippet.path,
							fragment: { kind: 'lines', from: snippet.from, to: snippet.to }
						})
					);
					head.replaceChildren(opens);
				}

				async function requote(snippet: CodeSnippet, to: SnippetPlace): Promise<void> {
					const taken = await code()?.requote(to, snippet.language);
					const pos = at();
					if (!taken || pos === undefined || editor.isDestroyed) return;
					editor.view.dispatch(
						editor.state.tr.setNodeMarkup(pos, undefined, snippetNode(taken).attrs)
					);
				}

				function standing(snippet: CodeSnippet, held: SnippetState): void {
					const said = stateSaid(snippet, held);
					dom.dataset.state = held.state;
					if (said === '') {
						state.replaceChildren();
						return;
					}
					const line = document.createElement('p');
					line.className = 'sloppy-snippet-said-now';
					line.textContent = said;
					const parts: HTMLElement[] = [line];
					if (held.state === 'changed') {
						parts.push(linesView(held.says, held.now.from, snippet.language));
					}
					if ((held.state === 'moved' || held.state === 'changed') && editor.isEditable) {
						const act = document.createElement('button');
						act.type = 'button';
						act.className = 'sloppy-snippet-act';
						act.textContent = REQUOTE;
						act.addEventListener('click', () => void requote(snippet, held.now));
						parts.push(act);
					}
					state.replaceChildren(...parts);
				}

				function draw(): void {
					const snippet = snippetIn(current);
					const mine = ++reading;
					delete dom.dataset.state;
					state.replaceChildren();
					if (!snippet) {
						head.replaceChildren();
						quoted.replaceChildren();
						return;
					}
					place(snippet);
					quoted.replaceChildren(linesView(snippet.source, snippet.from, snippet.language));
					const reaching = code();
					if (!reaching) return;
					void reaching.standing(snippet).then(
						(held) => {
							if (mine === reading && !editor.isDestroyed) standing(snippet, held);
						},
						() => {}
					);
				}

				draw();

				return {
					dom,
					update: (updated) => {
						if (updated.type.name !== SNIPPET_NODE) return false;
						const same = JSON.stringify(updated.attrs) === JSON.stringify(current.attrs);
						current = updated;
						if (!same) draw();
						return true;
					},
					selectNode: () => dom.classList.add('is-selected'),
					deselectNode: () => dom.classList.remove('is-selected'),
					stopEvent: (event) => (event.target as Element | null)?.closest?.('button') != null,
					ignoreMutation: () => true
				};
			};
		},

		addCommands() {
			return {
				insertSnippet:
					(snippet) =>
					({ chain, state }) => {
						const { at, content } = placeBlock(state, snippetNode(snippet));
						return chain().insertContentAt(at, content).run();
					}
			};
		}
	});
}
