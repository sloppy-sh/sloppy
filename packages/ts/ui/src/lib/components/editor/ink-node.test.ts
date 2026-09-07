// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubResizeObserver } from '../dom.test-support.js';
import { stubCanvas } from './editor.test-support.js';
import { InkNode } from './ink-node.js';

let editor: Editor | undefined;
let element: HTMLElement | undefined;

/** One note holding one drawing. */
function drawn(attrs: Record<string, unknown> = {}, editable = true): HTMLElement {
	element = document.createElement('div');
	document.body.append(element);
	editor = new Editor({
		element,
		editable,
		extensions: [StarterKit, InkNode],
		content: {
			type: 'doc',
			content: [{ type: 'ink', attrs: { width: 400, height: 120, strokes: [], ...attrs } }]
		}
	});
	return element;
}

const canvas = (at: HTMLElement) => at.querySelector('canvas') as HTMLCanvasElement;
const field = (at: HTMLElement) => at.querySelector('.sloppy-ink-description') as HTMLInputElement;
const stored = () =>
	(editor?.getJSON().content?.[0]?.attrs ?? {}) as { description?: string | null };

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

describe('what a drawing tells somebody who cannot see it', () => {
	it('is that it is a drawing, until its author says more', () => {
		const at = drawn();
		expect(canvas(at).getAttribute('role')).toBe('img');
		expect(canvas(at).getAttribute('aria-label')).toBe('Drawing');
	});

	it('is the description its author gave it', () => {
		const at = drawn({ description: 'the two axes, crossing' });
		expect(canvas(at).getAttribute('aria-label')).toBe('the two axes, crossing');
	});

	// The same node view draws a note somebody else wrote.
	it('is the same on a note nobody here can type into', () => {
		const at = drawn({ description: 'a leaf, half shaded' }, false);
		expect(canvas(at).getAttribute('aria-label')).toBe('a leaf, half shaded');
		expect(field(at)).toBeNull();
	});
});

describe('describing a drawing', () => {
	it('writes what was typed onto the drawing, and says it at once', () => {
		const at = drawn();
		field(at).value = 'a spiral, tightening';
		field(at).dispatchEvent(new Event('input', { bubbles: true }));

		expect(stored().description).toBe('a spiral, tightening');
		expect(canvas(at).getAttribute('aria-label')).toBe('a spiral, tightening');
	});

	it('leaves the drawing undescribed again when the words are taken back', () => {
		const at = drawn({ description: 'a spiral' });
		field(at).value = '';
		field(at).dispatchEvent(new Event('input', { bubbles: true }));

		expect(stored().description).toBeNull();
		expect(canvas(at).getAttribute('aria-label')).toBe('Drawing');
	});

	it('opens the field on what the drawing already says', () => {
		const at = drawn({ description: 'two axes' });
		expect(field(at).value).toBe('two axes');
	});

	// The one element of a note that otherwise leaves no text behind at all.
	it('is what a copy of the note carries away', () => {
		drawn({ description: 'the curve flattening out' });
		expect(editor?.getText()).toContain('the curve flattening out');
	});
});
