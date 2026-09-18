// A note's compass, as one element of a section: four slots, each holding the
// notes it points at. What is STORED is `compassNode` in `@sloppy/types` and
// nothing else — DESIGN.md § "The compass card" rules on what is drawn.

import {
	COMPASS_DIRECTIONS,
	COMPASS_TYPE,
	compassNode,
	compassOf,
	type Compass,
	type CompassDirection,
	type DocumentNode,
	type NodeView,
	type OwnedRef
} from '@sloppy/types';
import { Node, mergeAttributes, type Attribute } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { NoteReferences } from './contract.js';
import { placeBlock } from './placement.js';
import { citedAs, type ReferenceReader } from './reference-node.js';

export const COMPASS_NODE = COMPASS_TYPE;

/** What each slot is called, and what it asks while nothing is in it. Copy: the
 *  direction tokens are what a file and a peer carry. */
export const COMPASS_WORDS: Record<CompassDirection, { word: string; asks: string }> = {
	north: { word: 'Part of', asks: 'What larger pattern is this part of?' },
	south: { word: 'Made of', asks: 'What is this made of?' },
	east: { word: 'Like', asks: 'What else works like this?' },
	west: { word: 'Instead of', asks: 'What was chosen instead?' }
};

export const EMPTY_COMPASS: Compass = { north: [], south: [], east: [], west: [] };

/**
 * What a compass needs of the graph around it. Reading and opening are all a
 * surface nobody writes on uses, so a reader satisfies this as it stands and
 * the acts that fill a slot are simply not drawn.
 */
export interface CompassNotes extends ReferenceReader {
	find?: NoteReferences['find'];
	elsewhere?: NoteReferences['elsewhere'];
	write?: NoteReferences['write'];
}

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		compass: {
			/** Puts a compass in, or takes the caret to the one already here: a note
			 *  points one way, and only the first compass in it is read. */
			insertCompass: () => ReturnType;
		};
	}
}

const SHOWN = 6;
const SHOWN_ELSEWHERE = 4;
const COULD_NOT_WRITE = 'That note could not be added. Try again in a moment.';

/** The slots a stored node holds, read by the one reader of a compass. */
export function slotsIn(node: DocumentNode): Compass {
	return compassOf({ type: 'doc', content: [node] }) ?? EMPTY_COMPASS;
}

/** Where the note's compass stands, or null where it holds none. */
export function compassAt(doc: ProseMirrorNode): number | null {
	let found: number | null = null;
	doc.descendants((child, pos) => {
		if (found !== null) return false;
		if (child.type.name !== COMPASS_NODE) return true;
		found = pos;
		return false;
	});
	return found;
}

function readCitations(raw: string | null): unknown[] {
	if (!raw) return [];
	try {
		const held: unknown = JSON.parse(raw);
		return Array.isArray(held) ? held : [];
	} catch {
		return [];
	}
}

type Choice = { kind: 'note'; note: NodeView; graph?: string } | { kind: 'stub'; name: string };

export function CompassNode(references: () => CompassNotes | undefined) {
	return Node.create({
		name: COMPASS_NODE,
		group: 'block',
		atom: true,
		selectable: true,
		draggable: false,

		addAttributes() {
			const attrs: Record<string, Partial<Attribute>> = {};
			for (const direction of COMPASS_DIRECTIONS) {
				attrs[direction] = {
					default: [] as unknown[],
					parseHTML: (el) => readCitations(el.getAttribute(`data-${direction}`)),
					renderHTML: (held) => ({
						[`data-${direction}`]: JSON.stringify(held[direction] ?? [])
					})
				};
			}
			return attrs;
		},

		parseHTML() {
			return [{ tag: 'div[data-compass]' }];
		},

		renderHTML({ HTMLAttributes }) {
			return ['div', mergeAttributes(HTMLAttributes, { 'data-compass': 'true' })];
		},

		renderText({ node }) {
			const slots = slotsIn(node.toJSON() as DocumentNode);
			return COMPASS_DIRECTIONS.filter((direction) => slots[direction].length > 0)
				.map(
					(direction) => `${direction}: ${slots[direction].map((note) => `[[${note}]]`).join(' ')}`
				)
				.join('\n');
		},

		addNodeView() {
			return ({ node, editor, getPos }) => {
				let current = node;
				/** What a cited note is called now, which wins over what it was called
				 *  when it was cited. */
				const named = new Map<OwnedRef, { label: string; gone: boolean }>();
				const asked = new Set<OwnedRef>();
				let finding: CompassDirection | null = null;
				let highlighted = 0;
				let choices: Choice[] = [];
				let writing = false;
				let refused: string | null = null;

				const fillable = (): boolean => editor.isEditable && references()?.find !== undefined;

				const dom = document.createElement('div');
				dom.className = 'sloppy-compass';
				dom.setAttribute('contenteditable', 'false');
				dom.setAttribute('role', 'group');
				dom.setAttribute('aria-label', 'Compass');

				const rows = document.createElement('div');
				rows.className = 'sloppy-compass-slots';
				dom.append(rows);

				const finder = document.createElement('div');
				finder.className = 'sloppy-compass-finder';
				const field = document.createElement('input');
				field.type = 'text';
				field.className = 'sloppy-compass-field';
				field.autocomplete = 'off';
				field.setAttribute('role', 'combobox');
				field.setAttribute('aria-expanded', 'false');
				field.setAttribute('aria-autocomplete', 'list');
				const menu = document.createElement('ul');
				menu.className = 'sloppy-compass-menu';
				menu.setAttribute('role', 'listbox');
				const said = document.createElement('p');
				said.className = 'sloppy-compass-said';
				said.setAttribute('role', 'alert');
				finder.append(field, menu, said);

				/** The parts of each slot that a redraw writes into. Built once: the
				 *  field somebody is typing in must survive every draw. */
				const drawn = {} as Record<
					CompassDirection,
					{ list: HTMLUListElement; asks: HTMLParagraphElement; add: HTMLButtonElement }
				>;

				for (const direction of COMPASS_DIRECTIONS) {
					const { word, asks } = COMPASS_WORDS[direction];
					const slot = document.createElement('section');
					slot.className = 'sloppy-compass-slot';
					slot.dataset.direction = direction;
					slot.setAttribute('aria-label', word);

					const heading = document.createElement('h4');
					heading.className = 'sloppy-compass-word';
					heading.textContent = word;

					const list = document.createElement('ul');
					list.className = 'sloppy-compass-notes';

					const prompt = document.createElement('p');
					prompt.className = 'sloppy-compass-asks';
					prompt.textContent = asks;

					const add = document.createElement('button');
					add.type = 'button';
					add.className = 'sloppy-compass-act';
					add.textContent = 'Cite a note';
					add.setAttribute('aria-label', `Cite a note under ${word}`);
					add.addEventListener('mousedown', (event) => event.preventDefault());
					add.addEventListener('click', () => openFinder(direction));

					slot.append(heading, list, prompt, add);
					rows.append(slot);
					drawn[direction] = { list, asks: prompt, add };
				}

				const at = (): number | undefined => {
					const pos = typeof getPos === 'function' ? getPos() : undefined;
					return typeof pos === 'number' ? pos : undefined;
				};

				const held = (): Compass => slotsIn(current.toJSON() as DocumentNode);

				function keep(slots: Compass): void {
					const pos = at();
					if (pos === undefined || editor.isDestroyed) return;
					editor.view.dispatch(
						editor.state.tr.setNodeMarkup(pos, undefined, compassNode(slots).attrs)
					);
				}

				function cite(direction: CompassDirection, note: OwnedRef): void {
					const slots = held();
					if (slots[direction].includes(note)) return closeFinder();
					keep({ ...slots, [direction]: [...slots[direction], note] });
					closeFinder();
				}

				function drop(direction: CompassDirection, note: OwnedRef): void {
					const slots = held();
					keep({ ...slots, [direction]: slots[direction].filter((one) => one !== note) });
				}

				function openFinder(direction: CompassDirection): void {
					finding = direction;
					field.value = '';
					refused = null;
					writing = false;
					highlighted = 0;
					field.setAttribute('aria-label', `Cite a note under ${COMPASS_WORDS[direction].word}`);
					draw();
					field.focus();
				}

				function closeFinder(): void {
					finding = null;
					choices = [];
					refused = null;
					writing = false;
					draw();
				}

				function choicesFor(direction: CompassDirection, query: string): Choice[] {
					const reach = references();
					if (!reach?.find) return [];
					const name = query.trim();
					const already = new Set(held()[direction]);
					const found = reach
						.find(name)
						.filter((one) => !already.has(one.ref))
						.slice(0, SHOWN);
					const away = (reach.elsewhere?.(name) ?? [])
						.filter(({ note }) => !already.has(note.ref))
						.slice(0, SHOWN_ELSEWHERE)
						.map<Choice>(({ note, graph }) => ({ kind: 'note', note, graph }));
					const carrying = found.some((one) => one.title.toLowerCase() === name.toLowerCase());
					const shown = found.map<Choice>((note) => ({ kind: 'note', note }));
					if (!name || carrying || !reach.write) return [...shown, ...away];
					return [...shown, ...away, { kind: 'stub', name }];
				}

				async function take(direction: CompassDirection, choice: Choice): Promise<void> {
					if (choice.kind === 'note') return cite(direction, choice.note.ref);
					const reach = references();
					if (!reach?.write || writing) return;
					writing = true;
					refused = null;
					draw();
					try {
						// A note written from a slot springs from nothing: what a note is
						// part of is never written into the genealogy (AI.md).
						const written = await reach.write(choice.name, 'free');
						if (editor.isDestroyed) return;
						cite(direction, written.ref);
					} catch (error: unknown) {
						writing = false;
						refused = error instanceof Error && error.message ? error.message : COULD_NOT_WRITE;
						draw();
					}
				}

				field.addEventListener('input', () => {
					highlighted = 0;
					refused = null;
					draw();
				});
				field.addEventListener('keydown', (event) => {
					if (event.key === 'Escape') {
						// The sheet's escape layer does not consult `defaultPrevented`, so
						// an un-stopped Escape shuts the note being written in.
						event.preventDefault();
						event.stopPropagation();
						closeFinder();
						return;
					}
					if (choices.length === 0 || writing) return;
					if (event.key === 'ArrowDown') {
						event.preventDefault();
						highlighted = (highlighted + 1) % choices.length;
						draw();
					} else if (event.key === 'ArrowUp') {
						event.preventDefault();
						highlighted = (highlighted - 1 + choices.length) % choices.length;
						draw();
					} else if (event.key === 'Enter') {
						event.preventDefault();
						const direction = finding;
						if (direction) void take(direction, choices[highlighted]);
					}
				});

				/** A note is renamed after it is cited, so the slot says what it says
				 *  now. */
				function resolve(): void {
					const reach = references();
					if (!reach) return;
					const slots = held();
					for (const direction of COMPASS_DIRECTIONS) {
						for (const note of slots[direction]) {
							if (asked.has(note)) continue;
							asked.add(note);
							void reach
								.read(note)
								.then((found) => {
									named.set(
										note,
										found
											? { label: citedAs(found), gone: false }
											: { label: 'A note that is no longer here', gone: true }
									);
									if (!editor.isDestroyed) draw();
								})
								.catch(() => {
									// A lookup that failed says nothing about whether it is there.
									asked.delete(note);
								});
						}
					}
				}

				function cited(direction: CompassDirection, note: OwnedRef): HTMLLIElement {
					const row = document.createElement('li');
					const shown = named.get(note);
					const link = document.createElement('a');
					link.className = 'sloppy-reference';
					link.setAttribute('role', 'link');
					link.tabIndex = 0;
					link.textContent = shown?.label ?? 'A note';
					link.classList.toggle('is-gone', shown?.gone === true);
					const open = (event: Event) => {
						event.preventDefault();
						if (shown?.gone) return;
						references()?.open(note);
					};
					link.addEventListener('mousedown', (event) => event.preventDefault());
					link.addEventListener('click', open);
					link.addEventListener('keydown', (event) => {
						if (event.key === 'Enter' || event.key === ' ') open(event);
					});
					row.append(link);
					if (fillable()) {
						const off = document.createElement('button');
						off.type = 'button';
						off.className = 'sloppy-compass-off';
						off.textContent = '×';
						off.setAttribute(
							'aria-label',
							`Take ${link.textContent} out of ${COMPASS_WORDS[direction].word}`
						);
						off.addEventListener('mousedown', (event) => event.preventDefault());
						off.addEventListener('click', () => drop(direction, note));
						row.append(off);
					}
					return row;
				}

				function drawMenu(direction: CompassDirection): void {
					choices = choicesFor(direction, field.value);
					highlighted = Math.min(highlighted, Math.max(0, choices.length - 1));
					menu.replaceChildren();
					field.setAttribute('aria-expanded', choices.length > 0 ? 'true' : 'false');
					choices.forEach((choice, index) => {
						const row = document.createElement('li');
						row.className = 'sloppy-compass-choice';
						row.setAttribute('role', 'option');
						row.setAttribute('aria-selected', index === highlighted ? 'true' : 'false');
						row.textContent =
							choice.kind === 'stub'
								? `Write “${choice.name}” as a stub`
								: choice.graph
									? `${citedAs(choice.note)} · ${choice.graph}`
									: citedAs(choice.note);
						row.addEventListener('mousedown', (event) => event.preventDefault());
						row.addEventListener('click', () => void take(direction, choice));
						menu.append(row);
					});
					said.textContent = writing ? 'Writing that note…' : (refused ?? '');
					said.hidden = said.textContent === '';
				}

				function draw(): void {
					const slots = held();
					const canFill = fillable();
					for (const direction of COMPASS_DIRECTIONS) {
						const cites = slots[direction];
						const { list, asks, add } = drawn[direction];
						list.replaceChildren(...cites.map((note) => cited(direction, note)));
						list.hidden = cites.length === 0;
						asks.hidden = cites.length > 0;
						add.hidden = !canFill || finding === direction;
					}
					if (finding && canFill) {
						drawn[finding].add.after(finder);
						drawMenu(finding);
					} else {
						finder.remove();
					}
				}

				draw();
				resolve();

				return {
					dom,
					update: (updated) => {
						if (updated.type.name !== COMPASS_NODE) return false;
						current = updated;
						draw();
						resolve();
						return true;
					},
					selectNode: () => dom.classList.add('is-selected'),
					deselectNode: () => dom.classList.remove('is-selected'),
					stopEvent: () => true,
					ignoreMutation: () => true
				};
			};
		},

		addCommands() {
			return {
				insertCompass:
					() =>
					({ chain, state }) => {
						const standing = compassAt(state.doc);
						if (standing !== null) {
							return chain().setNodeSelection(standing).scrollIntoView().run();
						}
						const { at, content } = placeBlock(state, compassNode(EMPTY_COMPASS));
						return chain().insertContentAt(at, content).setNodeSelection(at).run();
					}
			};
		}
	});
}
