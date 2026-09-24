// A note's compass card, as one element of a section: the note in the middle
// and four slots around it, each holding the notes it points at. What is
// STORED is `compassNode` in `@sloppy/types` and nothing else — DESIGN.md
// § "The compass card" rules on what is drawn.

import {
	COMPASS_DIRECTIONS,
	COMPASS_KINDS,
	COMPASS_TYPE,
	compassMethod,
	compassNode,
	compassOf,
	compassSlots,
	compassSlotWords,
	DEFAULT_COMPASS_KIND,
	REFERENCE_NOTE_ATTR,
	type Compass,
	type CompassDirection,
	type CompassKind,
	type DocumentNode,
	type NodeView,
	type OwnedRef
} from '@sloppy/types';
import { Node, mergeAttributes, type Attribute } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { refusedWith } from '../../refusal.js';
import type { NoteReferences } from './contract.js';
import { placeBlock } from './placement.js';
import { citedAs, type ReferenceReader } from './reference-node.js';

export const COMPASS_NODE = COMPASS_TYPE;

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

/** The note the compass is on, which is what stands in the middle of the card. */
export type CompassCentre = Pick<NodeView, 'title' | 'address'>;

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

/** What a slot says while the method has no question for what it holds —
 *  DESIGN.md § "The compass card". */
const stillCited = (method: string, canFill: boolean): string =>
	`Still cited. ${method} has no question for these${
		canFill ? ' — take one out, or switch back' : ''
	}.`;

/** What one method is offered as: its name and the questions it would read the
 *  note by — DESIGN.md § "The compass card". */
const offeredAs = (kind: CompassKind): string =>
	`${compassMethod(kind).name} — ${compassSlots(kind)
		.map((direction) => compassSlotWords(kind, direction).word.toLowerCase())
		.join(', ')}`;

/** lucide's `x`, written out: nothing here renders through Svelte. */
const CROSS =
	'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
	'stroke-linecap="round" aria-hidden="true" focusable="false">' +
	'<path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

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

export function CompassNode(
	references: () => CompassNotes | undefined,
	centre: () => CompassCentre | undefined = () => undefined
) {
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
			attrs.kind = {
				default: null,
				parseHTML: (el) => el.getAttribute('data-kind'),
				renderHTML: (held) => (held.kind ? { 'data-kind': held.kind } : {})
			};
			return attrs;
		},

		parseHTML() {
			return [{ tag: 'div[data-compass]' }];
		},

		renderHTML({ HTMLAttributes }) {
			return ['div', mergeAttributes(HTMLAttributes, { 'data-compass': 'true' })];
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

				const chosen = document.createElement('select');
				chosen.className = 'sloppy-compass-method';
				chosen.setAttribute('aria-label', 'Which questions this compass asks');
				for (const kind of COMPASS_KINDS) {
					const option = document.createElement('option');
					option.value = kind;
					option.textContent = offeredAs(kind);
					chosen.append(option);
				}
				chosen.addEventListener('change', () => reads(chosen.value as CompassKind));
				const says = document.createElement('p');
				says.className = 'sloppy-compass-method-said';
				dom.append(chosen, says);

				const rows = document.createElement('div');
				rows.className = 'sloppy-compass-slots';
				dom.append(rows);

				const middle = document.createElement('div');
				middle.className = 'sloppy-compass-note';
				const standing = document.createElement('span');
				standing.className = 'address sloppy-compass-address';
				const called = document.createElement('p');
				called.className = 'sloppy-compass-title';
				middle.append(standing, called);
				rows.append(middle);

				const finder = document.createElement('div');
				finder.className = 'sloppy-compass-finder';
				const field = document.createElement('input');
				field.type = 'text';
				field.className = 'sloppy-compass-field';
				field.autocomplete = 'off';
				field.autocapitalize = 'off';
				field.spellcheck = false;
				field.setAttribute('autocorrect', 'off');
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
					{
						slot: HTMLElement;
						heading: HTMLHeadingElement;
						list: HTMLUListElement;
						asks: HTMLParagraphElement;
						kept: HTMLParagraphElement;
						add: HTMLButtonElement;
					}
				>;

				for (const direction of COMPASS_DIRECTIONS) {
					const slot = document.createElement('section');
					slot.className = 'sloppy-compass-slot';
					slot.dataset.direction = direction;

					const heading = document.createElement('h4');
					heading.className = 'sloppy-compass-word';

					const list = document.createElement('ul');
					list.className = 'sloppy-compass-notes';

					const prompt = document.createElement('p');
					prompt.className = 'sloppy-compass-asks';

					const kept = document.createElement('p');
					kept.className = 'sloppy-compass-kept';

					const add = document.createElement('button');
					add.type = 'button';
					add.className = 'sloppy-compass-act';
					add.textContent = 'Cite a note';
					add.addEventListener('mousedown', (event) => event.preventDefault());
					add.addEventListener('click', () => openFinder(direction));

					slot.append(heading, list, prompt, kept, add);
					rows.append(slot);
					drawn[direction] = { slot, heading, list, asks: prompt, kept, add };
				}

				const at = (): number | undefined => {
					const pos = typeof getPos === 'function' ? getPos() : undefined;
					return typeof pos === 'number' ? pos : undefined;
				};

				const held = (): Compass => slotsIn(current.toJSON() as DocumentNode);

				/** A slot exactly as it stands, entries this build cannot read
				 *  included: citing into one slot is not a chance to normalise the
				 *  other three (AI.md § "Provider-Agnostic Data Shapes"). */
				const entries = (direction: CompassDirection): unknown[] => {
					const standing: unknown = current.attrs[direction];
					return Array.isArray(standing) ? [...standing] : [];
				};

				const citing = (entry: unknown): unknown =>
					entry === null || typeof entry !== 'object'
						? undefined
						: (entry as Record<string, unknown>)[REFERENCE_NOTE_ATTR];

				const wordFor = (direction: CompassDirection): string =>
					compassSlotWords(held().kind, direction).word;

				function mark(changed: Record<string, unknown>): void {
					const pos = at();
					if (pos === undefined || editor.isDestroyed) return;
					editor.view.dispatch(
						editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...changed })
					);
				}

				function keep(direction: CompassDirection, slot: unknown[]): void {
					mark({ [direction]: slot });
				}

				/** Which questions the compass asks. No citation moves: every method
				 *  is read off the same four slots, so switching back finds them
				 *  where they were. */
				function reads(kind: CompassKind): void {
					// The picker belongs to the question that opened it, and the new
					// method may not ask that one.
					closeFinder();
					mark({ kind: kind === DEFAULT_COMPASS_KIND ? null : kind });
				}

				function cite(direction: CompassDirection, note: OwnedRef): void {
					if (held()[direction].includes(note)) return closeFinder();
					keep(direction, [...entries(direction), { [REFERENCE_NOTE_ATTR]: note }]);
					closeFinder();
				}

				function drop(direction: CompassDirection, note: OwnedRef): void {
					keep(
						direction,
						entries(direction).filter((one) => citing(one) !== note)
					);
				}

				/** Escape shuts the picker with nothing cited, wherever the keyboard
				 *  is by then — a field WebKit has taken the caret out of still has
				 *  the person's Escape to answer. Caught on the way down and stopped
				 *  there: the sheet's escape layer does not consult
				 *  `defaultPrevented`, so an un-stopped Escape shuts the note being
				 *  written in. */
				const shutOnEscape = (event: KeyboardEvent): void => {
					if (event.key !== 'Escape' || finding === null) return;
					event.preventDefault();
					event.stopPropagation();
					closeFinder();
				};

				function openFinder(direction: CompassDirection): void {
					finding = direction;
					field.value = '';
					refused = null;
					writing = false;
					highlighted = 0;
					field.setAttribute('aria-label', `Cite a note under ${wordFor(direction)}`);
					document.addEventListener('keydown', shutOnEscape, { capture: true });
					draw();
					field.focus();
				}

				function closeFinder(): void {
					document.removeEventListener('keydown', shutOnEscape, { capture: true });
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
						refused = refusedWith(error, COULD_NOT_WRITE);
						draw();
					}
				}

				field.addEventListener('input', () => {
					highlighted = 0;
					refused = null;
					draw();
				});
				field.addEventListener('keydown', (event) => {
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
						off.innerHTML = CROSS;
						off.setAttribute('aria-label', `Take ${link.textContent} out of ${wordFor(direction)}`);
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
					const method = compassMethod(slots.kind);
					const own = centre();
					middle.hidden = own === undefined;
					standing.textContent = own?.address ?? '';
					standing.hidden = !own?.address;
					called.textContent = own ? own.title || 'Untitled' : '';
					chosen.value = slots.kind ?? DEFAULT_COMPASS_KIND;
					chosen.hidden = !editor.isEditable;
					says.textContent = method.name;
					says.hidden = editor.isEditable || slots.kind === undefined;
					rows.toggleAttribute('data-rose', compassSlots(slots.kind).length === 4);
					for (const direction of COMPASS_DIRECTIONS) {
						const cites = slots[direction];
						const { slot, heading, list, asks, kept, add } = drawn[direction];
						const words = method.slots[direction];
						// A slot this method has no question for still holds citations
						// somebody made, and the canvas still draws them.
						const carried = words === undefined && cites.length > 0;
						slot.hidden = words === undefined && cites.length === 0;
						heading.textContent = compassSlotWords(slots.kind, direction).word;
						slot.setAttribute('aria-label', heading.textContent);
						list.replaceChildren(...cites.map((note) => cited(direction, note)));
						list.hidden = cites.length === 0;
						asks.textContent = words?.asks ?? '';
						asks.hidden = words === undefined || cites.length > 0;
						kept.textContent = carried ? stillCited(method.name, canFill) : '';
						kept.hidden = !carried;
						add.hidden = !canFill || words === undefined || finding === direction;
						add.setAttribute('aria-label', `Cite a note under ${heading.textContent}`);
					}
					if (finding && canFill) {
						// `after` re-inserts a node that is already there, and an input
						// taken out of the document loses the keyboard mid-word, so the
						// finder is moved only when it is somewhere else.
						const { add } = drawn[finding];
						if (add.nextSibling !== finder) add.after(finder);
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
					destroy: () => {
						document.removeEventListener('keydown', shutOnEscape, { capture: true });
					},
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
