// @vitest-environment jsdom
import type { BlockDocument, BlockView, OwnedRef } from '@sloppy/types';
import type { Editor } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubResizeObserver } from '../dom.test-support.js';
import {
	docBlocks,
	heldApart,
	openDraft,
	planSave,
	runSave,
	textSection,
	type DocBlock,
	type NoteDraft,
	type SavedBlock
} from './document.js';
import { block, makeEditor, section, stubCanvas, text } from './editor.test-support.js';
import { nextUid } from './section-node.js';

let editor: Editor | undefined;
/** What the API holds for the stack `open` was handed. */
let opened: SavedBlock[] = [];

beforeEach(() => {
	stubResizeObserver();
	stubCanvas();
});

afterEach(() => {
	editor?.destroy();
	editor = undefined;
	opened = [];
	document.body.innerHTML = '';
});

function open(blocks = [] as BlockView[]) {
	const made = makeEditor(blocks);
	editor = made.editor;
	opened = made.saved;
	return made.editor;
}

const rows = (of: Editor): DocBlock[] => docBlocks(of.state.doc);

/** The words in a section, in order, so a test can say what it means. */
const wording = (content: BlockDocument): string[] =>
	content.content.map((element) => element.content?.map((run) => run.text ?? '').join('') ?? '');

/** A stack of rows that answers the way the API does, so a whole round can run:
 *  every write stamps the row, and one that names a stamp the row has moved past
 *  is refused. */
function stack(initial: BlockView[]) {
	const held = initial;
	let tick = 0;
	const stamped = () => new Date(Date.UTC(2026, 1, 1, 0, 0, ++tick)).toISOString();
	const at = (ref: OwnedRef) => held.findIndex((row) => row.ref === ref);
	const put = (after: OwnedRef | null, row: BlockView) =>
		held.splice((after ? at(after) : -1) + 1, 0, row);
	return {
		held,
		read: () => held.map((row) => wording(row.content)),
		/** A write from somewhere else, which moves the row on. */
		elsewhere: (ref: OwnedRef, says: string) => {
			held[at(ref)] = { ...held[at(ref)], content: one(says), updated_at: stamped() };
		},
		writer: {
			create: async (request: { after: OwnedRef | null; content: BlockDocument }) => {
				const made = block({ content: request.content, updated_at: stamped() });
				put(request.after, made);
				return { ref: made.ref, updated_at: made.updated_at };
			},
			update: async (ref: OwnedRef, content: BlockDocument, expects: string | undefined) => {
				const row = held[at(ref)];
				if (expects !== undefined && expects !== row.updated_at) {
					throw new Error('That section was written somewhere else.');
				}
				const now = stamped();
				held[at(ref)] = { ...row, content, updated_at: now };
				return now;
			},
			reorder: async (ref: OwnedRef, after: OwnedRef | null) => {
				const row = held.splice(at(ref), 1)[0];
				put(after, row);
				return row.updated_at;
			},
			remove: async (ref: OwnedRef) => {
				held.splice(at(ref), 1);
			},
			placed: () => {}
		}
	};
}

/** One open-edit-close round, with no memory carried across it but the rows. */
async function round(of: ReturnType<typeof stack>, edit: (editor: Editor) => void = () => {}) {
	const made = makeEditor(of.held);
	edit(made.editor);
	const next = rows(made.editor);
	await runSave(planSave(made.saved, next), made.saved, next, of.writer);
	made.editor.destroy();
}

const INK = {
	type: 'ink',
	attrs: {
		strokes: [{ points: [{ x: 1, y: 2, pressure: 0.4, t: 0 }], width: 2 }],
		width: 400,
		height: 120,
		raster_upload_id: null
	}
};

describe('a stack of sections opened as one document', () => {
	const written = section(
		{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Where it begins' }] },
		...text('It begins beside another one.', 'And carries on.'),
		{
			type: 'bulletList',
			content: [{ type: 'listItem', content: text('first') }]
		}
	);

	it('gives a whole section back exactly as it was stored', () => {
		const stored = block({ content: written });
		const read = rows(open([stored]));
		expect(read).toHaveLength(1);
		expect(read[0].content).toEqual(written);
		expect(read[0].ref).toBe(stored.ref);
	});

	it('has nothing to save the moment it opens', () => {
		const of = open([
			block({ content: written }),
			block({ content: section(...text('A second thought.'), INK) })
		]);
		expect(planSave(opened, rows(of))).toEqual([]);
	});

	it('makes no row out of the empty section a new note opens on', () => {
		expect(rows(open())).toEqual([]);
	});

	it('writes a section down once, and again only where somebody wrote into it', () => {
		const of = open([
			block({ content: written }),
			block({ content: section(...text('A second thought.'), INK) })
		]);
		const first = rows(of);
		expect(rows(of)[0].content).toBe(first[0].content);

		of.commands.insertContentAt(2, 'Not ');
		const after = rows(of);
		expect(after[0].content).not.toBe(first[0].content);
		expect(after[1].content).toBe(first[1].content);
	});

	// The store hands an element's attributes back in its own key order, so a
	// note opens with attributes ordered differently from the way the editor
	// writes them. Comparing the two as text would rewrite every note on sight.
	it('writes nothing back for a section whose attributes come back in another order', () => {
		const of = open([
			block({
				content: section(
					{ type: 'heading', content: [{ type: 'text', text: 'Reordered' }], attrs: { level: 2 } },
					{
						type: 'ink',
						attrs: {
							height: 120,
							raster_upload_id: null,
							strokes: [{ points: [{ pressure: 0.4, t: 0, x: 1, y: 2 }], width: 2 }],
							width: 400
						}
					}
				)
			})
		]);
		expect(planSave(opened, rows(of))).toEqual([]);
	});

	it('keeps a drawing as its strokes, inside the section it was made in', () => {
		const of = open([block({ content: section(...text('a thought'), INK) })]);
		const [row] = rows(of);
		expect(row.content.content.map((element) => element.type)).toEqual(['paragraph', 'ink']);
		expect(row.content.content[1].attrs).toEqual(INK.attrs);
	});

	it('carries a row holding a kind it has no renderer for, rather than rewriting it', async () => {
		const of = stack([
			block({ content: section({ type: 'sketchpad', attrs: { later: true } }) }),
			block({ content: section(...text('beside it')) })
		]);
		const drawn = open(of.held);
		expect(rows(drawn).map((row) => wording(row.content))).toEqual([['beside it']]);

		for (let pass = 0; pass < 3; pass += 1) {
			await round(of, (editor) => {
				editor.commands.setTextSelection(editor.state.doc.content.size - 2);
				editor.commands.insertContent('!');
			});
		}
		expect(of.read()).toEqual([[''], ['beside it!!!']]);
		expect(of.held[0].content.content[0]).toEqual({ type: 'sketchpad', attrs: { later: true } });
	});

	it('carries a drawing it cannot read, and opens the rest of the note around it', async () => {
		const unreadable = { type: 'ink', attrs: { strokes: 'not strokes', width: 400, height: 120 } };
		const of = stack([
			block({ content: section(...text('where it begins'), unreadable) }),
			block({ content: section(...text('beside it')) })
		]);
		const drawn = open(of.held);
		expect(rows(drawn).map((row) => wording(row.content))).toEqual([['beside it']]);

		await round(of, (editor) => {
			editor.commands.setTextSelection(editor.state.doc.content.size - 2);
			editor.commands.insertContent('!');
		});
		expect(of.read()).toEqual([['where it begins', ''], ['beside it!']]);
		expect(of.held[0].content.content[1]).toEqual(unreadable);
	});
});

describe('Enter, inside a section', () => {
	it('makes another paragraph in the same section rather than another block', () => {
		const stored = block({ content: section(...text('beforeafter')) });
		const of = open([stored]);
		const saved = opened;
		of.commands.setTextSelection(8);
		of.commands.splitBlock();

		const read = rows(of);
		expect(read).toHaveLength(1);
		expect(read[0].ref).toBe(saved[0].ref);
		expect(wording(read[0].content)).toEqual(['before', 'after']);
		expect(planSave(saved, read)).toEqual([
			{ kind: 'update', ref: saved[0].ref, content: read[0].content }
		]);
	});

	it('leaves the stack one section however many times it is pressed', () => {
		const of = open([block({ content: section(...text('one')) })]);
		for (let press = 0; press < 5; press += 1) {
			of.commands.setTextSelection(of.state.doc.content.size - 2);
			of.commands.splitBlock();
			of.commands.insertContent('more');
		}
		expect(rows(of)).toHaveLength(1);
		expect(of.state.doc.childCount).toBe(1);
	});
});

describe('adding a section', () => {
	it('is the only thing that makes one, and it becomes a row once written in', () => {
		const of = open([block({ content: section(...text('a first thought')) })]);
		of.commands.addSection();
		expect(rows(of)).toHaveLength(1);

		of.commands.insertContent('a separate thought');
		const read = rows(of);
		expect(read).toHaveLength(2);
		expect(read[1].ref).toBeNull();
		expect(planSave(opened, read)).toEqual([
			{ kind: 'create', uid: read[1].uid, after: read[0].uid, content: read[1].content }
		]);
	});

	it('lands at the end of the stack, wherever the caret was', () => {
		const of = open([
			block({ content: section(...text('first')) }),
			block({ content: section(...text('second')) })
		]);
		of.commands.setTextSelection(2);
		of.commands.addSection();
		of.commands.insertContent('last');
		expect(rows(of).map((row) => wording(row.content))).toEqual([['first'], ['second'], ['last']]);
	});

	it('takes one back when it is backspaced into with nothing written in it', () => {
		const of = open([block({ content: section(...text('a first thought')) })]);
		of.commands.addSection();
		expect(of.state.doc.childCount).toBe(2);

		of.view.dispatch(of.state.tr.scrollIntoView());
		of.commands.keyboardShortcut('Backspace');
		expect(of.state.doc.childCount).toBe(1);
	});

	it('keeps the last section, so a note always has somewhere to write', () => {
		const of = open();
		of.commands.keyboardShortcut('Backspace');
		expect(of.state.doc.childCount).toBe(1);
	});
});

const one = (words: string): BlockDocument => section(...text(words));
const row = (uid: string, ref: string, words: string): SavedBlock => ({
	uid,
	ref: ref as SavedBlock['ref'],
	content: one(words)
});
const doc = (uid: string, ref: string | null, words: string): DocBlock => ({
	uid,
	ref: ref as DocBlock['ref'],
	content: one(words)
});

describe('what has to reach the API', () => {
	it('says nothing when nothing moved or changed', () => {
		expect(planSave([row('u1', 'a/A', 'one')], [doc('u1', 'a/A', 'one')])).toEqual([]);
	});

	it('writes the whole section back when anything in it changed', () => {
		expect(planSave([row('u1', 'a/A', 'one')], [doc('u1', 'a/A', 'two')])).toEqual([
			{ kind: 'update', ref: 'a/A', content: one('two') }
		]);
	});

	it('deletes a row the document no longer has', () => {
		expect(
			planSave([row('u1', 'a/A', 'one'), row('u2', 'a/B', 'two')], [doc('u1', 'a/A', 'one')])
		).toEqual([{ kind: 'remove', ref: 'a/B' }]);
	});

	it('anchors a new section to the one it follows, even a new one', () => {
		expect(
			planSave(
				[row('u1', 'a/A', 'one')],
				[doc('u1', 'a/A', 'one'), doc('u2', null, 'two'), doc('u3', null, 'three')]
			)
		).toEqual([
			{ kind: 'create', uid: 'u2', after: 'u1', content: one('two') },
			{ kind: 'create', uid: 'u3', after: 'u2', content: one('three') }
		]);
	});

	it('anchors a section written above everything to nothing', () => {
		expect(
			planSave([row('u1', 'a/A', 'one')], [doc('u2', null, 'new'), doc('u1', 'a/A', 'one')])
		).toEqual([{ kind: 'create', uid: 'u2', after: null, content: one('new') }]);
	});

	it('moves a section that changed places rather than rewriting the stack', () => {
		expect(
			planSave(
				[row('u1', 'a/A', 'one'), row('u2', 'a/B', 'two'), row('u3', 'a/C', 'three')],
				[doc('u3', 'a/C', 'three'), doc('u1', 'a/A', 'one'), doc('u2', 'a/B', 'two')]
			)
		).toEqual([{ kind: 'reorder', ref: 'a/C', after: null }]);
	});

	// One drag is one `ord`, however far the section travelled: every section it
	// passed kept its place relative to the others and so has nothing to write.
	it('writes one move for a section dragged past every other section', () => {
		expect(
			planSave(
				[
					row('u1', 'a/A', 'one'),
					row('u2', 'a/B', 'two'),
					row('u3', 'a/C', 'three'),
					row('u4', 'a/D', 'four')
				],
				[
					doc('u2', 'a/B', 'two'),
					doc('u3', 'a/C', 'three'),
					doc('u4', 'a/D', 'four'),
					doc('u1', 'a/A', 'one')
				]
			)
		).toEqual([{ kind: 'reorder', ref: 'a/A', after: 'u4' }]);
	});

	// The order the writer sees is the order the note is stored in, whatever they
	// did to reach it — dragging a section and then adding one under it is two
	// ordinary steps, and it is the batch where a create anchors on a row the
	// same batch also moves.
	it('leaves the stack in the order the document is in, for any edit reaching one save', async () => {
		let seed = 0x9e3779b9;
		const upto = (bound: number): number => {
			seed = (seed * 1664525 + 1013904223) >>> 0;
			return Math.floor((seed / 0x1_0000_0000) * bound);
		};

		for (let trial = 0; trial < 2000; trial++) {
			const saved = Array.from({ length: 2 + upto(6) }, (_, at) =>
				row(`u${at}`, `a/row ${at}`, `row ${at}`)
			);
			const next: DocBlock[] = saved.map((held) =>
				doc(held.uid, held.ref, wording(held.content)[0])
			);
			let minted = 0;
			for (let edit = 0, edits = 1 + upto(4); edit < edits; edit++) {
				const pick = upto(3);
				if (pick === 0 && next.length > 1) {
					next.splice(upto(next.length), 0, ...next.splice(upto(next.length), 1));
				} else if (pick === 1) {
					const made = `new ${minted++}`;
					next.splice(upto(next.length + 1), 0, doc(made, null, made));
				} else if (next.length > 1) {
					next.splice(upto(next.length), 1);
				}
			}

			// The API, as a list that only ever places a row after another one. A
			// row is its own wording here, and every ref names the section it holds.
			const held = saved.map((row) => wording(row.content)[0]);
			const at = (ref: OwnedRef) => held.indexOf(ref.slice(2));
			const place = (after: OwnedRef | null, words: string) =>
				held.splice((after ? at(after) : -1) + 1, 0, words);
			const writer = {
				create: async (request: { after: OwnedRef | null; content: BlockDocument }) => {
					place(request.after, wording(request.content)[0]);
					return { ref: `a/${wording(request.content)[0]}` as OwnedRef };
				},
				update: async () => undefined,
				reorder: async (ref: OwnedRef, after: OwnedRef | null) => {
					place(after, held.splice(at(ref), 1)[0]);
					return undefined;
				},
				remove: async (ref: OwnedRef) => void held.splice(at(ref), 1),
				placed: () => {}
			};

			const mine = saved.map((row) => ({ ...row }));
			await runSave(planSave(mine, next), mine, next, writer);
			expect({ trial, held }).toEqual({
				trial,
				held: next.map((block) => wording(block.content)[0])
			});
		}
	});

	it('treats a section pasted in from another note as a new one here', () => {
		expect(planSave([], [doc('u1', 'somewhere/ELSE', 'borrowed')])).toEqual([
			{ kind: 'create', uid: 'u1', after: null, content: one('borrowed') }
		]);
	});

	it('makes no second row for a section whose create landed after the document was read', () => {
		expect(planSave([row('u2', 'a/B', 'two')], [doc('u2', null, 'two')])).toEqual([]);
	});

	it('still moves such a section, and writes what changed in it', () => {
		expect(
			planSave(
				[row('u1', 'a/A', 'one'), row('u2', 'a/B', 'two')],
				[doc('u2', null, 'two, revised'), doc('u1', 'a/A', 'one')]
			)
		).toEqual([
			{ kind: 'update', ref: 'a/B', content: one('two, revised') },
			{ kind: 'reorder', ref: 'a/B', after: null }
		]);
	});
});

describe('a note this device is still holding writing for', () => {
	/** The surface, opened from the draft against the stack the API answered
	 *  with, and what would reach the API from there. */
	function reopen(draft: NoteDraft, held: BlockView[]) {
		const made = makeEditor();
		const from = openDraft(draft, held, made.editor.schema);
		made.editor.commands.setContent(from.doc, { emitUpdate: false });
		const next = docBlocks(made.editor.state.doc);
		const saved = from.baseline(next);
		const plan = planSave(saved, next);
		made.editor.destroy();
		return { says: next.map((block) => wording(block.content)[0]), saved, plan };
	}

	/** What a surface would have kept: the rows it was measured against, and the
	 *  document it planned. */
	const draftOf = (rows: SavedBlock[], next: DocBlock[]): NoteDraft => ({ rows, next });

	const stamped = (ref: string, words: string, at: string): BlockView =>
		block({ ref: ref as OwnedRef, content: one(words), updated_at: at });
	const measured = (uid: string, ref: string, words: string, at: string): SavedBlock => ({
		...row(uid, ref, words),
		updated_at: at
	});
	const FIRST = '2026-01-01T00:00:00.000Z';
	const SINCE = '2026-01-02T00:00:00.000Z';

	it('opens on the unsent writing, and sends what the API is missing', () => {
		const reopened = reopen(
			draftOf([measured('u1', 'a/A', 'as it was', FIRST)], [doc('u1', 'a/A', 'as it was written')]),
			[stamped('a/A', 'as it was', FIRST)]
		);
		expect(reopened.says).toEqual(['as it was written']);
		expect(reopened.plan).toEqual([
			{ kind: 'update', ref: 'a/A', content: one('as it was written') }
		]);
		expect(reopened.saved[0].updated_at).toBe(FIRST);
	});

	it('sends a section that was never written down at all', () => {
		const reopened = reopen(
			draftOf(
				[measured('u1', 'a/A', 'the first', FIRST)],
				[doc('u1', 'a/A', 'the first'), doc('u2', null, 'and one more')]
			),
			[stamped('a/A', 'the first', FIRST)]
		);
		expect(reopened.says).toEqual(['the first', 'and one more']);
		expect(reopened.plan).toEqual([
			expect.objectContaining({ kind: 'create', content: one('and one more') })
		]);
	});

	it('does not bring back a section taken away somewhere else', () => {
		const reopened = reopen(
			draftOf(
				[measured('u1', 'a/A', 'the first', FIRST), measured('u2', 'a/B', 'the second', FIRST)],
				[doc('u1', 'a/A', 'the first, revised'), doc('u2', 'a/B', 'the second')]
			),
			[stamped('a/A', 'the first', FIRST)]
		);
		expect(reopened.says).toEqual(['the first, revised']);
		expect(reopened.plan).toEqual([
			{ kind: 'update', ref: 'a/A', content: one('the first, revised') }
		]);
	});

	it('keeps both versions of a section written in two places, and writes over neither', () => {
		const reopened = reopen(
			draftOf([measured('u1', 'a/A', 'as it was', FIRST)], [doc('u1', 'a/A', 'what I wrote here')]),
			[stamped('a/A', 'what they wrote there', SINCE)]
		);
		expect(reopened.says).toEqual(['what they wrote there', 'what I wrote here']);
		expect(reopened.plan).toEqual([
			expect.objectContaining({ kind: 'create', content: one('what I wrote here') })
		]);
	});

	it('brings in a section written elsewhere since, where it stands', () => {
		const reopened = reopen(
			draftOf(
				[measured('u1', 'a/A', 'the first', FIRST)],
				[doc('u1', 'a/A', 'the first, revised')]
			),
			[stamped('a/A', 'the first', FIRST), stamped('a/B', 'theirs, after mine', SINCE)]
		);
		expect(reopened.says).toEqual(['the first, revised', 'theirs, after mine']);
		expect(reopened.plan).toEqual([
			{ kind: 'update', ref: 'a/A', content: one('the first, revised') }
		]);
	});

	it('keeps a section this device took away that somebody has written into since', () => {
		const reopened = reopen(
			draftOf(
				[measured('u1', 'a/A', 'the first', FIRST), measured('u2', 'a/B', 'the second', FIRST)],
				[doc('u1', 'a/A', 'the first')]
			),
			[stamped('a/A', 'the first', FIRST), stamped('a/B', 'the second, theirs', SINCE)]
		);
		expect(reopened.says).toEqual(['the first', 'the second, theirs']);
		expect(reopened.plan).toEqual([]);
	});

	it('takes away a section this device took away, which nobody has touched since', () => {
		const reopened = reopen(
			draftOf(
				[measured('u1', 'a/A', 'the first', FIRST), measured('u2', 'a/B', 'the second', FIRST)],
				[doc('u1', 'a/A', 'the first')]
			),
			[stamped('a/A', 'the first', FIRST), stamped('a/B', 'the second', FIRST)]
		);
		expect(reopened.says).toEqual(['the first']);
		expect(reopened.plan).toEqual([{ kind: 'remove', ref: 'a/B' }]);
	});

	it('takes it away even where a new section is handed the uid it was written down under', () => {
		// The uids the reopened document is about to be handed: one for the empty
		// section the editor is built on, then one per section of the draft.
		const at = Number(nextUid().slice(1));
		const reopened = reopen(
			draftOf(
				[
					measured(`b${at + 3}`, 'a/A', 'the first', FIRST),
					measured('u2', 'a/B', 'the second', FIRST)
				],
				[doc('u2', 'a/B', 'the second'), doc('u3', null, 'and one more')]
			),
			[stamped('a/A', 'the first', FIRST), stamped('a/B', 'the second', FIRST)]
		);
		expect(reopened.says).toEqual(['the second', 'and one more']);
		expect(reopened.plan).toEqual([
			expect.objectContaining({ kind: 'create', content: one('and one more') }),
			{ kind: 'remove', ref: 'a/A' }
		]);
	});

	it('has nothing left to send once the writing landed after all', () => {
		const reopened = reopen(
			draftOf([measured('u1', 'a/A', 'as it was', FIRST)], [doc('u1', 'a/A', 'as it was written')]),
			[stamped('a/A', 'as it was written', SINCE)]
		);
		expect(reopened.says).toEqual(['as it was written']);
		expect(reopened.plan).toEqual([]);
	});
});

describe('a held draft met by writing done since the note opened', () => {
	/** The note on screen, written in since it opened, with what the draft puts
	 *  in beside that; and what would reach the API from there. */
	function beside(draft: NoteDraft, on: BlockView[], typing?: (of: Editor) => void) {
		const made = makeEditor(on);
		typing?.(made.editor);
		for (const { at, sections } of heldApart(draft, made.editor.state.doc, made.editor.schema)) {
			made.editor.commands.insertContentAt(at, sections);
		}
		const next = docBlocks(made.editor.state.doc);
		const plan = planSave(made.saved, next);
		made.editor.destroy();
		return { says: next.map((block) => wording(block.content)[0]), plan };
	}

	const stored = () => block({ ref: 'a/A' as OwnedRef, content: one('as it was') });
	const writtenSince = (of: Editor) => of.commands.insertContentAt(2, 'since, ');

	it('puts a section that was never sent after the row it followed', () => {
		const met = beside(
			{
				rows: [row('u1', 'a/A', 'as it was')],
				next: [doc('u1', 'a/A', 'as it was'), doc('u2', null, 'and one more')]
			},
			[stored()],
			writtenSince
		);
		expect(met.says).toEqual(['since, as it was', 'and one more']);
		expect(met.plan).toEqual([
			{ kind: 'update', ref: 'a/A', content: one('since, as it was') },
			expect.objectContaining({ kind: 'create', content: one('and one more') })
		]);
	});

	it('leaves a row as it stands where the draft had nothing unsent for it', () => {
		const met = beside(
			{ rows: [row('u1', 'a/A', 'as it was')], next: [doc('u1', 'a/A', 'as it was')] },
			[stored()],
			writtenSince
		);
		expect(met.says).toEqual(['since, as it was']);
		expect(met.plan).toEqual([{ kind: 'update', ref: 'a/A', content: one('since, as it was') }]);
	});

	it('keeps both readings of a row the draft and the writing since disagree on', () => {
		const met = beside(
			{ rows: [row('u1', 'a/A', 'as it was')], next: [doc('u1', 'a/A', 'as I had it')] },
			[stored()],
			writtenSince
		);
		expect(met.says).toEqual(['since, as it was', 'as I had it']);
		expect(met.plan).toEqual([
			{ kind: 'update', ref: 'a/A', content: one('since, as it was') },
			expect.objectContaining({ kind: 'create', content: one('as I had it') })
		]);
	});

	it('does not bring back a section taken away somewhere else', () => {
		const met = beside(
			{
				rows: [row('u1', 'a/A', 'as it was'), row('u2', 'a/B', 'the second')],
				next: [doc('u1', 'a/A', 'as it was'), doc('u2', 'a/B', 'the second, revised')]
			},
			[stored()],
			writtenSince
		);
		expect(met.says).toEqual(['since, as it was']);
		expect(met.plan).toEqual([{ kind: 'update', ref: 'a/A', content: one('since, as it was') }]);
	});
});

describe('a section written in two places at once', () => {
	it('names the stamp it last saw, and is refused rather than writing over the other', async () => {
		const of = stack([block({ content: one('as it was') })]);
		const made = makeEditor(of.held);
		const first = docBlocks(made.editor.state.doc);
		made.editor.commands.insertContentAt(2, 'mine over ');
		const next = docBlocks(made.editor.state.doc);
		expect(first).not.toEqual(next);

		of.elsewhere(of.held[0].ref, 'theirs, already there');

		await expect(runSave(planSave(made.saved, next), made.saved, next, of.writer)).rejects.toThrow(
			'written somewhere else'
		);
		expect(of.read()).toEqual([['theirs, already there']]);
		made.editor.destroy();
	});

	it('lands, and keeps the stamp true, where nobody else has written', async () => {
		const of = stack([block({ content: one('as it was') })]);
		const made = makeEditor(of.held);
		made.editor.commands.insertContentAt(2, 'mine over ');
		const next = docBlocks(made.editor.state.doc);
		await runSave(planSave(made.saved, next), made.saved, next, of.writer);
		expect(of.read()).toEqual([['mine over as it was']]);
		expect(made.saved[0].updated_at).toBe(of.held[0].updated_at);

		made.editor.commands.insertContentAt(2, 'and again, ');
		const after = docBlocks(made.editor.state.doc);
		await runSave(planSave(made.saved, after), made.saved, after, of.writer);
		expect(of.read()).toEqual([['and again, mine over as it was']]);
		made.editor.destroy();
	});
});

describe('carrying a plan out', () => {
	function recorder(mints: string[], failAt = Infinity) {
		const calls: string[] = [];
		const step = (label: string) => {
			calls.push(label);
			if (calls.length === failAt) throw new Error('the API said no');
		};
		return {
			calls,
			create: async (request: { after: OwnedRef | null }) => {
				step(`create after ${request.after ?? 'nothing'}`);
				return { ref: mints.shift() as OwnedRef };
			},
			update: async (ref: OwnedRef) => {
				step(`update ${ref}`);
				return undefined;
			},
			reorder: async (ref: OwnedRef) => {
				step(`reorder ${ref}`);
				return undefined;
			},
			remove: async (ref: OwnedRef) => step(`remove ${ref}`),
			placed: () => {}
		};
	}

	it('anchors each new section to the row the one before it became', async () => {
		const saved = [row('u1', 'a/A', 'one')];
		const next = [doc('u1', 'a/A', 'one'), doc('u2', null, 'two'), doc('u3', null, 'three')];
		const writer = recorder(['a/B', 'a/C']);
		await runSave(planSave(saved, next), saved, next, writer);
		expect(writer.calls).toEqual(['create after a/A', 'create after a/B']);
		expect(saved.map((r) => r.ref)).toEqual(['a/A', 'a/B', 'a/C']);
	});

	it('leaves a true record behind when the API stops answering half way', async () => {
		const saved: SavedBlock[] = [];
		const next = [doc('u1', null, 'one'), doc('u2', null, 'two'), doc('u3', null, 'three')];
		await expect(
			runSave(planSave(saved, next), saved, next, recorder(['a/A'], 2))
		).rejects.toThrow();
		expect(saved.map((r) => r.ref)).toEqual(['a/A']);

		expect(planSave(saved, next)).toEqual([
			{ kind: 'create', uid: 'u2', after: 'u1', content: one('two') },
			{ kind: 'create', uid: 'u3', after: 'u2', content: one('three') }
		]);
	});
});

describe('a picture in a section', () => {
	const UPLOAD = 'did:syr:z6Mk1/01ABCDEF';
	const PICTURE = {
		type: 'picture',
		attrs: { upload_id: UPLOAD, width: 40, height: 20, alt: 'a kite' }
	};

	it('is stored as the upload it came from, and written back unchanged', () => {
		const of = open([block({ content: section(PICTURE) })]);
		expect(rows(of)[0].content).toEqual(section(PICTURE));
		expect(planSave(opened, rows(of))).toEqual([]);
	});

	// Otherwise a note is stored pointing at bytes that may never arrive.
	it('is not written down while the file is still on its way', () => {
		const of = open([block({ content: section(...text('a thought')) })]);
		of.commands.insertPicture({ preview: 'blob:sloppy/1' });
		const kinds = () => rows(of)[0].content.content.map((element) => element.type);
		expect(kinds()).not.toContain('picture');

		of.commands.insertPicture({ upload_id: UPLOAD, width: 40, height: 20 });
		expect(kinds().filter((kind) => kind === 'picture')).toHaveLength(1);
	});

	it('leaves the moment-to-moment of a send out of what is stored', () => {
		const of = open([block({ content: section(...text('a thought')) })]);
		of.commands.insertPicture({ upload_id: UPLOAD, preview: 'blob:sloppy/1' });
		const stored = rows(of)[0].content.content.find((element) => element.type === 'picture');
		expect(Object.keys(stored?.attrs ?? {})).toEqual(['upload_id']);
	});

	it('makes a section of nothing but a picture on its way no row at all', () => {
		const of = open();
		of.commands.insertPicture({ preview: 'blob:sloppy/1' });
		expect(rows(of)).toEqual([]);
	});
});

describe('the section a note opens on when somebody arrives holding writing', () => {
	it('gives a paragraph to a line, and nothing to a blank one', () => {
		const made = textSection('two bars\n\nstill four seconds\n');
		expect(made?.content).toEqual([
			{ type: 'paragraph', content: [{ type: 'text', text: 'two bars' }] },
			{ type: 'paragraph', content: [{ type: 'text', text: 'still four seconds' }] }
		]);
	});

	it('is a section a save can write, with no row behind it yet', () => {
		const made = textSection('a thought');
		expect(made?.type).toBe('section');
		expect(made?.attrs?.blockRef).toBeNull();
		expect(made?.attrs?.blockUid).toEqual(expect.any(String));
	});

	it('is nothing at all where nothing was written', () => {
		expect(textSection('   \n\n ')).toBeNull();
	});
});
