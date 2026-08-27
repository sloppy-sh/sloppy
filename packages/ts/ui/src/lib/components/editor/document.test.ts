// @vitest-environment jsdom
import type { BlockType, BlockView, InkBlockData, OwnedRef } from '@sloppy/types';
import type { Editor } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubResizeObserver } from '../dom.test-support.js';
import { docBlocks, planSave, runSave, type DocBlock, type SavedBlock } from './document.js';
import { block, makeEditor, stubCanvas } from './editor.test-support.js';

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

function open(blocks = [] as ReturnType<typeof block>[]) {
	const made = makeEditor(blocks);
	editor = made.editor;
	opened = made.saved;
	return made.editor;
}

const rows = (of: Editor): DocBlock[] => docBlocks(of.state.doc, of.storage.markdown.manager);

/** A stack of rows that answers the way the API does, so a whole round can run. */
function stack(initial: BlockView[]) {
	const held = initial;
	const at = (ref: OwnedRef) => held.findIndex((row) => row.ref === ref);
	const put = (after: OwnedRef | null, row: BlockView) =>
		held.splice((after ? at(after) : -1) + 1, 0, row);
	return {
		held,
		read: () => held.map((row) => [row.type, row.content] as const),
		writer: {
			create: async (request: {
				after: OwnedRef | null;
				type: BlockType;
				content: string;
				data?: unknown;
			}) => {
				const made = block(request);
				put(request.after, made);
				return made.ref;
			},
			update: async (ref: OwnedRef, changes: Record<string, unknown>) => {
				Object.assign(held[at(ref)], changes);
			},
			reorder: async (ref: OwnedRef, after: OwnedRef | null) => {
				put(after, held.splice(at(ref), 1)[0]);
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

describe('a stack opened as one document', () => {
	it('gives each kind of block back as the type it was stored as', () => {
		const stored = [
			block({ type: 'heading', content: '## Where a thought begins' }),
			block({ type: 'paragraph', content: 'It begins beside another one.' }),
			block({ type: 'list', content: '- first\n- second' }),
			block({ type: 'todo', content: '- [ ] ask about it' }),
			block({ type: 'code', content: '```ts\nconst a = 1;\n```' })
		];
		const read = rows(open(stored));
		expect(read.map((row) => row.type)).toEqual(['heading', 'paragraph', 'list', 'todo', 'code']);
		expect(read.map((row) => row.content)).toEqual(stored.map((row) => row.content));
		expect(read.map((row) => row.ref)).toEqual(stored.map((row) => row.ref));
	});

	it('has nothing to save the moment it opens', () => {
		const of = open([
			block({ type: 'heading', content: '## Where a thought begins' }),
			block({ type: 'paragraph', content: 'It begins beside another one.' }),
			block({ type: 'list', content: '- first\n- second' }),
			block({ type: 'todo', content: '- [ ] ask about it' }),
			block({ type: 'code', content: '```ts\nconst a = 1;\n```' }),
			block({ type: 'ink', data: { strokes: [], width: 400, height: 120 } })
		]);
		expect(planSave(opened, rows(of))).toEqual([]);
	});

	it('does not make a row out of the blank line waiting to be typed in', () => {
		const of = open();
		expect(rows(of)).toEqual([]);
	});

	it('keeps a drawing as its strokes, not as text', () => {
		const data: InkBlockData = {
			strokes: [{ points: [{ x: 1, y: 2, pressure: 0.4, t: 0 }], width: 2 }],
			width: 400,
			height: 120
		};
		const of = open([block({ type: 'ink', data })]);
		const [row] = rows(of);
		expect(row.type).toBe('ink');
		expect(row.content).toBe('');
		expect(row.data).toEqual({ strokes: data.strokes, width: 400, height: 120 });
	});

	it('answers a row whose Markdown is two blocks by cutting it down and writing the rest', () => {
		const stored = block({ type: 'paragraph', content: 'one\n\ntwo' });
		const of = open([stored]);
		const read = rows(of);
		expect(read.map((row) => row.content)).toEqual(['one', 'two']);
		expect(planSave(opened, read)).toEqual([
			{ kind: 'update', ref: stored.ref, content: 'one' },
			{ kind: 'create', uid: read[1].uid, after: read[0].uid, type: 'paragraph', content: 'two' }
		]);
	});

	it('splits such a row once, however many times the note is opened and written', async () => {
		const of = stack([block({ type: 'paragraph', content: 'one\n\ntwo' })]);
		for (let pass = 0; pass < 3; pass += 1) await round(of);
		expect(of.read()).toEqual([
			['paragraph', 'one'],
			['paragraph', 'two']
		]);
	});

	it('carries a kind it has no node for untouched, rather than making prose of it', async () => {
		const of = stack([
			block({ type: 'image', content: '![a sketch](https://example.com/a.png)' }),
			block({ type: 'paragraph', content: 'beside it' }),
			block({ type: 'embed', content: 'https://example.com/thing' })
		]);
		const drawn = open(of.held);
		expect(rows(drawn).map((row) => row.content)).toEqual(['beside it']);

		for (let pass = 0; pass < 3; pass += 1) {
			await round(of, (editor) => {
				editor.commands.setTextSelection(editor.state.doc.content.size - 1);
				editor.commands.insertContent('!');
			});
		}
		expect(of.read()).toEqual([
			['image', '![a sketch](https://example.com/a.png)'],
			['paragraph', 'beside it!!!'],
			['embed', 'https://example.com/thing']
		]);
	});
});

describe('a split is a new block, and the old one keeps its row', () => {
	it('makes the second half a create and leaves the first alone', () => {
		const of = open([block({ type: 'paragraph', content: 'before after' })]);
		const saved = opened;
		of.commands.setTextSelection(8);
		of.commands.splitBlock();

		const read = rows(of);
		expect(read.map((row) => row.content)).toEqual(['before', 'after']);
		expect(read[0].ref).toBe(saved[0].ref);
		expect(read[1].ref).toBeNull();
		expect(read[0].uid).not.toBe(read[1].uid);

		expect(planSave(saved, read)).toEqual([
			{ kind: 'update', ref: saved[0].ref, content: 'before' },
			{ kind: 'create', uid: read[1].uid, after: read[0].uid, type: 'paragraph', content: 'after' }
		]);
	});
});

const row = (uid: string, ref: string, content: string): SavedBlock => ({
	uid,
	ref: ref as SavedBlock['ref'],
	type: 'paragraph',
	content
});
const doc = (uid: string, ref: string | null, content: string): DocBlock => ({
	uid,
	ref: ref as DocBlock['ref'],
	type: 'paragraph',
	content
});

describe('what has to reach the API', () => {
	it('says nothing when nothing moved or changed', () => {
		expect(planSave([row('u1', 'a/A', 'one')], [doc('u1', 'a/A', 'one')])).toEqual([]);
	});

	it('reports only the field that changed', () => {
		expect(planSave([row('u1', 'a/A', 'one')], [doc('u1', 'a/A', 'two')])).toEqual([
			{ kind: 'update', ref: 'a/A', content: 'two' }
		]);
	});

	it('deletes a row the document no longer has', () => {
		expect(
			planSave([row('u1', 'a/A', 'one'), row('u2', 'a/B', 'two')], [doc('u1', 'a/A', 'one')])
		).toEqual([{ kind: 'remove', ref: 'a/B' }]);
	});

	it('anchors a new block to the block it follows, even a new one', () => {
		expect(
			planSave(
				[row('u1', 'a/A', 'one')],
				[doc('u1', 'a/A', 'one'), doc('u2', null, 'two'), doc('u3', null, 'three')]
			)
		).toEqual([
			{ kind: 'create', uid: 'u2', after: 'u1', type: 'paragraph', content: 'two' },
			{ kind: 'create', uid: 'u3', after: 'u2', type: 'paragraph', content: 'three' }
		]);
	});

	it('anchors a block written above everything to nothing', () => {
		expect(
			planSave([row('u1', 'a/A', 'one')], [doc('u2', null, 'new'), doc('u1', 'a/A', 'one')])
		).toEqual([{ kind: 'create', uid: 'u2', after: null, type: 'paragraph', content: 'new' }]);
	});

	it('moves a block that changed places rather than rewriting the stack', () => {
		expect(
			planSave(
				[row('u1', 'a/A', 'one'), row('u2', 'a/B', 'two'), row('u3', 'a/C', 'three')],
				[doc('u3', 'a/C', 'three'), doc('u1', 'a/A', 'one'), doc('u2', 'a/B', 'two')]
			)
		).toEqual([{ kind: 'reorder', ref: 'a/C', after: null }]);
	});

	it('treats a row pasted in from another note as a new block here', () => {
		expect(planSave([], [doc('u1', 'somewhere/ELSE', 'borrowed')])).toEqual([
			{ kind: 'create', uid: 'u1', after: null, type: 'paragraph', content: 'borrowed' }
		]);
	});

	it('makes no second row for a block whose create landed after the document was read', () => {
		expect(planSave([row('u2', 'a/B', 'two')], [doc('u2', null, 'two')])).toEqual([]);
	});

	it('still moves such a block, and writes what changed in it', () => {
		expect(
			planSave(
				[row('u1', 'a/A', 'one'), row('u2', 'a/B', 'two')],
				[doc('u2', null, 'two, revised'), doc('u1', 'a/A', 'one')]
			)
		).toEqual([
			{ kind: 'update', ref: 'a/B', content: 'two, revised' },
			{ kind: 'reorder', ref: 'a/B', after: null }
		]);
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
				return mints.shift() as OwnedRef;
			},
			update: async (ref: OwnedRef) => step(`update ${ref}`),
			reorder: async (ref: OwnedRef) => step(`reorder ${ref}`),
			remove: async (ref: OwnedRef) => step(`remove ${ref}`),
			placed: () => {}
		};
	}

	it('anchors each new block to the row the one before it became', async () => {
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
			{ kind: 'create', uid: 'u2', after: 'u1', type: 'paragraph', content: 'two' },
			{ kind: 'create', uid: 'u3', after: 'u2', type: 'paragraph', content: 'three' }
		]);
	});
});

describe('a picture in a note', () => {
	const UPLOAD = 'did:syr:z6Mk1/01ABCDEF';

	it('opens as the block it was stored as, and is written back unchanged', () => {
		const of = open([
			block({ type: 'image', data: { upload_id: UPLOAD, width: 40, height: 20, alt: 'a kite' } })
		]);
		expect(rows(of)).toEqual([
			expect.objectContaining({
				type: 'image',
				content: '',
				data: { upload_id: UPLOAD, width: 40, height: 20, alt: 'a kite' }
			})
		]);
		expect(planSave(opened, rows(of))).toEqual([]);
	});

	// Otherwise a note is stored pointing at bytes that may never arrive.
	it('is not a row while the file is still on its way', () => {
		const of = open();
		of.commands.insertPicture({ preview: 'blob:sloppy/1' });
		expect(rows(of).some((row) => row.type === 'image')).toBe(false);

		of.commands.insertPicture({ uploadId: UPLOAD, width: 40, height: 20 });
		expect(rows(of).filter((row) => row.type === 'image')).toHaveLength(1);
	});

	// A row nothing can be drawn from is carried, not opened as an empty one and
	// saved back over.
	it('leaves a row naming no file exactly as it was found', () => {
		const of = open([block({ type: 'image', data: {} })]);
		expect(rows(of).some((row) => row.type === 'image')).toBe(false);
		expect(planSave(opened, rows(of))).toEqual([]);
	});
});
