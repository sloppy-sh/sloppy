// @vitest-environment jsdom
import { type CodeSnippet, snippetNode, type SnippetState } from '@sloppy/types';
import type { Editor } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubResizeObserver } from '../dom.test-support.js';
import type { NoteCode } from './contract.js';
import { docBlocks } from './document.js';
import { block, makeEditor, noCode, section, stubCanvas } from './editor.test-support.js';

const QUOTE: CodeSnippet = {
	path: 'src/parser.ts',
	from: 2,
	to: 3,
	digest: `sha256:${'ab'.repeat(32)}`,
	source: 'const two = 2;\nconst three = 3;',
	language: 'ts'
};

let editor: Editor | undefined;

function open(code?: NoteCode): Editor {
	editor = makeEditor([block({ content: section(snippetNode(QUOTE)) })], code).editor;
	return editor;
}

async function settle(): Promise<void> {
	for (let at = 0; at < 3; at += 1) await new Promise((done) => setTimeout(done, 0));
}

const shown = (selector: string) => document.body.querySelector<HTMLElement>(selector);

function standingAs(held: SnippetState): NoteCode {
	return noCode({ standing: async () => held });
}

beforeEach(() => {
	stubResizeObserver();
	stubCanvas();
});

afterEach(() => {
	editor?.destroy();
	editor = undefined;
	document.body.innerHTML = '';
});

describe('a quote of code in a note', () => {
	it('is written down exactly as it was quoted', () => {
		const into = open();
		expect(docBlocks(into.state.doc)[0].content.content).toEqual([snippetNode(QUOTE)]);
	});

	it('shows where it was quoted from and its lines, numbered from there', () => {
		open();
		expect(shown('.sloppy-snippet-place')?.textContent).toBe('src/parser.ts · L2–3');
		expect(
			[...document.body.querySelectorAll('.sloppy-snippet-number')].map((one) => one.textContent)
		).toEqual(['2', '3']);
		expect(shown('.sloppy-snippet-place')?.tagName).toBe('SPAN');
	});

	it('says nothing more where the code still reads this way', async () => {
		open(standingAs({ state: 'unchanged' }));
		await settle();
		expect(shown('.sloppy-snippet-state')?.textContent).toBe('');
	});

	it('says where moved code is now, and quotes it there when asked', async () => {
		const asked: unknown[] = [];
		const into = open(
			noCode({
				standing: async () => ({
					state: 'moved',
					now: { path: QUOTE.path, from: 5, to: 6 }
				}),
				requote: async (place, language) => {
					asked.push([place, language]);
					return { ...QUOTE, from: 5, to: 6 };
				}
			})
		);
		await settle();
		expect(shown('.sloppy-snippet-said-now')?.textContent).toBe('This code has moved to L5–6.');
		shown('.sloppy-snippet-act')?.click();
		await settle();
		expect(asked).toEqual([[{ path: QUOTE.path, from: 5, to: 6 }, 'ts']]);
		expect(docBlocks(into.state.doc)[0].content.content).toEqual([
			snippetNode({ ...QUOTE, from: 5, to: 6 })
		]);
	});

	it('shows what changed code says now under the quote', async () => {
		open(
			standingAs({
				state: 'changed',
				now: { path: QUOTE.path, from: 2, to: 3 },
				says: 'const two = 20;\nconst three = 3;'
			})
		);
		await settle();
		expect(shown('.sloppy-snippet-said-now')?.textContent).toBe(
			'This code has changed since it was quoted. It reads now:'
		);
		expect(shown('.sloppy-snippet-state .sloppy-snippet-lines')?.textContent).toContain(
			'const two = 20;'
		);
		expect(shown('.sloppy-snippet-act')).not.toBeNull();
	});

	it('says removed code is gone, and offers nothing to quote', async () => {
		open(standingAs({ state: 'removed' }));
		await settle();
		expect(shown('.sloppy-snippet-said-now')?.textContent).toBe(
			'This code is not in the project now.'
		);
		expect(shown('.sloppy-snippet-act')).toBeNull();
	});

	it('opens the code sheet on the quoted lines from where it was quoted', async () => {
		const opened: unknown[] = [];
		open(noCode({ show: (anchor) => opened.push(anchor) }));
		shown('.sloppy-snippet-place')?.click();
		expect(opened).toEqual([{ path: QUOTE.path, fragment: { kind: 'lines', from: 2, to: 3 } }]);
	});
});
