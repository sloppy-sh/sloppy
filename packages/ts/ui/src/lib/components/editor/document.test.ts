// @vitest-environment jsdom
import type { InkBlockData, OwnedRef } from '@sloppy/types';
import type { Editor } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubResizeObserver } from '../dom.test-support.js';
import { docBlocks, planSave, runSave, type DocBlock, type SavedBlock } from './document.js';
import { block, makeEditor, stubCanvas } from './editor.test-support.js';

let editor: Editor | undefined;

beforeEach(() => {
	stubResizeObserver();
	stubCanvas();
});

afterEach(() => {
	editor?.destroy();
	editor = undefined;
	document.body.innerHTML = '';
});

function open(blocks = [] as ReturnType<typeof block>[]) {
	editor = makeEditor(blocks);
	return editor;
}

const rows = (of: Editor): DocBlock[] => docBlocks(of.state.doc, of.storage.markdown.manager);
const savedFrom = (of: Editor): SavedBlock[] =>
	rows(of)
		.filter((row) => row.ref)
		.map((row) => ({ ref: row.ref!, type: row.type, content: row.content, data: row.data }));

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
		const of = open([block({ type: 'paragraph', content: 'unchanged' })]);
		expect(planSave(savedFrom(of), rows(of))).toEqual([]);
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

	it('answers a row whose Markdown is two blocks by writing two rows', () => {
		const stored = block({ type: 'paragraph', content: 'one\n\ntwo' });
		const of = open([stored]);
		const read = rows(of);
		expect(read.map((row) => row.content)).toEqual(['one', 'two']);
		expect(planSave(savedFrom(of), read)).toEqual([
			{ kind: 'create', uid: read[1].uid, after: read[0].uid, type: 'paragraph', content: 'two' }
		]);
	});
});

describe('a split is a new block, and the old one keeps its row', () => {
	it('makes the second half a create and leaves the first alone', () => {
		const of = open([block({ type: 'paragraph', content: 'before after' })]);
		const saved = savedFrom(of);
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

const row = (ref: string, content: string): SavedBlock => ({
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
		expect(planSave([row('a/A', 'one')], [doc('u1', 'a/A', 'one')])).toEqual([]);
	});

	it('reports only the field that changed', () => {
		expect(planSave([row('a/A', 'one')], [doc('u1', 'a/A', 'two')])).toEqual([
			{ kind: 'update', ref: 'a/A', content: 'two' }
		]);
	});

	it('deletes a row the document no longer has', () => {
		expect(planSave([row('a/A', 'one'), row('a/B', 'two')], [doc('u1', 'a/A', 'one')])).toEqual([
			{ kind: 'remove', ref: 'a/B' }
		]);
	});

	it('anchors a new block to the block it follows, even a new one', () => {
		expect(
			planSave(
				[row('a/A', 'one')],
				[doc('u1', 'a/A', 'one'), doc('u2', null, 'two'), doc('u3', null, 'three')]
			)
		).toEqual([
			{ kind: 'create', uid: 'u2', after: 'u1', type: 'paragraph', content: 'two' },
			{ kind: 'create', uid: 'u3', after: 'u2', type: 'paragraph', content: 'three' }
		]);
	});

	it('anchors a block written above everything to nothing', () => {
		expect(
			planSave([row('a/A', 'one')], [doc('u2', null, 'new'), doc('u1', 'a/A', 'one')])
		).toEqual([{ kind: 'create', uid: 'u2', after: null, type: 'paragraph', content: 'new' }]);
	});

	it('moves a block that changed places rather than rewriting the stack', () => {
		expect(
			planSave(
				[row('a/A', 'one'), row('a/B', 'two'), row('a/C', 'three')],
				[doc('u3', 'a/C', 'three'), doc('u1', 'a/A', 'one'), doc('u2', 'a/B', 'two')]
			)
		).toEqual([{ kind: 'reorder', ref: 'a/C', after: null }]);
	});

	it('treats a row pasted in from another note as a new block here', () => {
		expect(planSave([], [doc('u1', 'somewhere/ELSE', 'borrowed')])).toEqual([
			{ kind: 'create', uid: 'u1', after: null, type: 'paragraph', content: 'borrowed' }
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
		const saved = [row('a/A', 'one')];
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

		next[0].ref = 'a/A' as DocBlock['ref'];
		expect(planSave(saved, next)).toEqual([
			{ kind: 'create', uid: 'u2', after: 'u1', type: 'paragraph', content: 'two' },
			{ kind: 'create', uid: 'u3', after: 'u2', type: 'paragraph', content: 'three' }
		]);
	});

	it('stops the moment the surface has moved to another note', async () => {
		const saved: SavedBlock[] = [];
		const next = [doc('u1', null, 'one'), doc('u2', null, 'two')];
		const writer = { ...recorder(['a/A', 'a/B']), abandoned: () => true };
		await runSave(planSave(saved, next), saved, next, writer);
		expect(writer.calls).toEqual([]);
		expect(saved).toEqual([]);
	});
});
