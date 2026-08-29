// @vitest-environment jsdom
import type { BlockView, CreateBlockRequest } from '@sloppy/types';
import type { Editor } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubResizeObserver } from '../dom.test-support.js';
import { docBlocks, planSave } from '../editor/document.js';
import { block, makeEditor, ref, stubCanvas } from '../editor/editor.test-support.js';
import { NOTE_TEMPLATES, writeTemplate, type NoteTemplate } from './templates.js';

const claim = NOTE_TEMPLATES.find((template) => template.id === 'claim') as NoteTemplate;

/** The rows a shape becomes, answered as the API answers. */
function seeded(template: NoteTemplate): Promise<BlockView[]> {
	return writeTemplate(template, { node: block().node }, (request: CreateBlockRequest) =>
		Promise.resolve(block({ ref: ref(), content: request.content as BlockView['content'] }))
	);
}

/** Where the line under a section's name begins. */
function underTheName(editor: Editor, section: number): number {
	let at = 0;
	for (let before = 0; before < section; before++) at += editor.state.doc.child(before).nodeSize;
	return at + 1 + editor.state.doc.child(section).child(0).nodeSize + 1;
}

const headings = () =>
	[...document.querySelectorAll('section h2')].map((heading) => heading.textContent);

beforeEach(() => {
	stubResizeObserver();
	stubCanvas();
});

afterEach(() => {
	document.body.innerHTML = '';
});

describe('a note started from a shape', () => {
	it('opens as its sections, named and empty', async () => {
		const { editor } = makeEditor(await seeded(claim));
		const named = claim.sections.map((section) => section.heading);

		expect(headings()).toEqual(named);
		expect(document.querySelectorAll('section')).toHaveLength(named.length);
		expect(document.querySelector('[data-ink-block]')).not.toBeNull();
		// Nothing but the names: every section opens with somewhere to put a thing.
		expect(editor.state.doc.textContent).toBe(named.join(''));
	});

	it('writes back only the section written in, and complains about none of the rest', async () => {
		const { editor, saved } = makeEditor(await seeded(claim));

		editor.commands.insertContentAt(underTheName(editor, 1), 'because the thing happened twice');

		const ops = planSave(saved, docBlocks(editor.state.doc));
		expect(ops).toEqual([
			{ kind: 'update', ref: saved[1].ref, content: expect.anything() as unknown }
		]);
	});
});
