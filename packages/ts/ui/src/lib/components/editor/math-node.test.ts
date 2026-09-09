// @vitest-environment jsdom
import type { BlockView } from '@sloppy/types';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubResizeObserver } from '../dom.test-support.js';
import { docBlocks } from './document.js';
import { block, makeEditor, section, stubCanvas, text, typeInto } from './editor.test-support.js';
import { drawMath, MathBlockNode, MathNode } from './math-node.js';

let editor: Editor | undefined;
let element: HTMLElement | undefined;

/** One note holding whatever is written into it, on the surface a writer has. */
function open(...blocks: BlockView[]): Editor {
	const made = makeEditor(blocks);
	editor = made.editor;
	return made.editor;
}

const kinds = (of: Editor): string[] =>
	docBlocks(of.state.doc).flatMap((row) => row.content.content.map((held) => held.type));

const drawn = () => document.body.querySelector('.sloppy-math-drawn');
const source = () =>
	document.body.querySelector<HTMLTextAreaElement>('.sloppy-math-block .sloppy-math-source');

beforeEach(() => {
	stubResizeObserver();
	stubCanvas();
});

afterEach(() => {
	editor?.destroy();
	editor = undefined;
	element?.remove();
	element = undefined;
	document.body.innerHTML = '';
});

describe('a formula on the page', () => {
	it('is the TeX somebody wrote, drawn', () => {
		const into = document.createElement('div');
		expect(drawMath('E = mc^2', true, into)).toBe('');
		expect(into.querySelector('.katex')).not.toBeNull();
		expect(into.textContent).toContain('mc');
	});

	it('is nothing at all until somebody has written one', () => {
		const into = document.createElement('div');
		expect(drawMath('   ', false, into)).toBe('');
		expect(into.childElementCount).toBe(0);
	});

	it('is a sentence about the formula where the TeX will not draw', () => {
		const into = document.createElement('div');
		const said = drawMath('\\frac{1}{', true, into);
		expect(said.startsWith("This formula didn't come out.")).toBe(true);
		expect(said.length).toBeGreaterThan("This formula didn't come out.".length);
		expect(into.childElementCount).toBe(0);
	});
});

describe('writing a formula', () => {
	it('stands one on its own where a line holds only $$, with room to write on', () => {
		const into = open(block({ content: section(...text('')) }));
		into.commands.setTextSelection(2);
		typeInto(into, '$$');
		expect(kinds(into)).toEqual(['mathBlock', 'paragraph']);
	});

	it('closes one inside a sentence at the second dollar', () => {
		const into = open(block({ content: section(...text('')) }));
		into.commands.setTextSelection(2);
		typeInto(into, 'let $x^2$ be');
		const [row] = docBlocks(into.state.doc);
		const line = row.content.content[0].content ?? [];
		expect(line.map((held) => held.type)).toEqual(['text', 'math', 'text']);
		expect(line[1].attrs).toEqual({ tex: 'x^2' });
		expect(line.map((held) => held.text ?? '').join('')).toBe('let  be');
	});

	it('leaves two prices in one sentence as two prices', () => {
		const into = open(block({ content: section(...text('')) }));
		into.commands.setTextSelection(2);
		typeInto(into, 'it cost $5 and $6');
		const [row] = docBlocks(into.state.doc);
		expect(row.content.content[0].content?.map((held) => held.text)).toEqual(['it cost $5 and $6']);
	});

	it('goes into the section the writing is already in', () => {
		const into = open(block({ content: section(...text('a thought')) }));
		into.commands.setTextSelection(into.state.doc.content.size - 2);
		into.commands.splitBlock();
		typeInto(into, '$$');
		expect(docBlocks(into.state.doc)).toHaveLength(1);
		expect(kinds(into)).toEqual(['paragraph', 'mathBlock', 'paragraph']);
	});
});

describe('a formula in a note', () => {
	it('is drawn with its source beside it, for the person writing', () => {
		open(block({ content: section({ type: 'mathBlock', attrs: { tex: 'a^2 + b^2' } }) }));
		expect(drawn()?.querySelector('.katex')).not.toBeNull();
		expect(source()?.value).toBe('a^2 + b^2');
	});

	it('keeps what somebody types into that source', () => {
		const into = open(block({ content: section({ type: 'mathBlock', attrs: { tex: 'a' } }) }));
		const field = source() as HTMLTextAreaElement;
		field.value = '\\sqrt{2}';
		field.dispatchEvent(new Event('input'));
		expect(docBlocks(into.state.doc)[0].content.content[0].attrs).toEqual({ tex: '\\sqrt{2}' });
		expect(drawn()?.querySelector('.katex')).not.toBeNull();
	});

	// The sheet the note is written in closes on Escape too, and it listens on the
	// document: leaving the formula must not cost the writer the note.
	it('lets nothing else have the Escape that leaves its source', () => {
		const heard: Event[] = [];
		const listen = (event: Event) => heard.push(event);
		document.addEventListener('keydown', listen);
		try {
			open(block({ content: section({ type: 'mathBlock', attrs: { tex: 'a' } }) }));
			const field = source() as HTMLTextAreaElement;
			field.dispatchEvent(
				new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
			);
			expect(heard).toHaveLength(0);
		} finally {
			document.removeEventListener('keydown', listen);
		}
	});

	// The same node view draws a note somebody else wrote.
	it('is drawn without a source on a note nobody here can type into', () => {
		element = document.createElement('div');
		document.body.append(element);
		editor = new Editor({
			element,
			editable: false,
			extensions: [StarterKit, MathNode, MathBlockNode],
			content: {
				type: 'doc',
				content: [{ type: 'mathBlock', attrs: { tex: 'e^{i\\pi} + 1 = 0' } }]
			}
		});
		expect(drawn()?.querySelector('.katex')).not.toBeNull();
		expect(source()).toBeNull();
	});

	it('reads back out of the note exactly as it was stored', () => {
		const stored = section(
			...text('what it comes to'),
			{ type: 'mathBlock', attrs: { tex: 'a^2 + b^2 = c^2' } },
			{
				type: 'paragraph',
				content: [
					{ type: 'text', text: 'and ' },
					{ type: 'math', attrs: { tex: '\\pi' } }
				]
			}
		);
		const into = open(block({ content: stored }));
		expect(docBlocks(into.state.doc)[0].content).toEqual(stored);
	});

	it('carries a formula it cannot read, and opens the rest of the note around it', () => {
		const into = open(
			block({ content: section({ type: 'mathBlock', attrs: { tex: 17 } }) }),
			block({ content: section(...text('beside it')) })
		);
		expect(docBlocks(into.state.doc)).toHaveLength(1);
		expect(kinds(into)).toEqual(['paragraph']);
	});
});
