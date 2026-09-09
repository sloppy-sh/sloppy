// @vitest-environment jsdom
import type { BlockView } from '@sloppy/types';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubResizeObserver } from '../dom.test-support.js';
import { DiagramNode } from './diagram-node.js';
import { docBlocks } from './document.js';
import { block, makeEditor, section, stubCanvas, text, typeInto } from './editor.test-support.js';

/** The renderer, stood in for: the suite says what a diagram element does with
 *  what comes back, not what Mermaid draws. */
const drawings = vi.hoisted(() => ({
	asked: [] as string[],
	fails: false
}));

vi.mock('mermaid', () => ({
	default: {
		initialize: () => {},
		render: async (id: string, source: string) => {
			drawings.asked.push(source);
			if (drawings.fails) throw new Error('Parse error on line 2:\nand more about it');
			return { svg: `<svg data-drawn="${id}"><g></g></svg>` };
		}
	}
}));

let editor: Editor | undefined;
let element: HTMLElement | undefined;

/** One note holding whatever is written into it, on the surface a writer has. */
function open(...blocks: BlockView[]): Editor {
	const made = makeEditor(blocks);
	editor = made.editor;
	return made.editor;
}

async function settle(): Promise<void> {
	for (let at = 0; at < 3; at += 1) await new Promise((done) => setTimeout(done, 0));
}

const CHART = 'graph TD; A-->B;';

const kinds = (of: Editor): string[] =>
	docBlocks(of.state.doc).flatMap((row) => row.content.content.map((held) => held.type));

const picture = () => document.body.querySelector('.sloppy-diagram-drawn');
const trouble = () => document.body.querySelector('.sloppy-diagram-trouble')?.textContent ?? '';
const source = () => document.body.querySelector<HTMLTextAreaElement>('.sloppy-diagram-source');

beforeEach(() => {
	drawings.asked = [];
	drawings.fails = false;
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

describe('writing a diagram', () => {
	it('opens one where a line holds only a mermaid fence', () => {
		const into = open(block({ content: section() }));
		into.commands.setTextSelection(2);
		typeInto(into, '```mermaid ');
		expect(kinds(into)).toEqual(['diagram', 'paragraph']);
		expect(docBlocks(into.state.doc)[0].content.content[0].attrs).toEqual({
			language: 'mermaid',
			source: ''
		});
	});

	it('leaves a fence in a language it does not draw as a code block', () => {
		const into = open(block({ content: section() }));
		into.commands.setTextSelection(2);
		typeInto(into, '```rust ');
		expect(into.state.doc.firstChild?.firstChild?.type.name).toBe('codeBlock');
	});

	it('lands after the element that is selected, not in front of it', () => {
		const into = open(
			block({ content: section(...text('a thought'), { type: 'mathBlock', attrs: { tex: 'a' } }) })
		);
		let formula = -1;
		into.state.doc.descendants((held, at) => {
			if (held.type.name === 'mathBlock') formula = at;
		});
		into.commands.setNodeSelection(formula);
		into.commands.insertDiagram();
		expect(kinds(into)).toEqual(['paragraph', 'mathBlock', 'diagram', 'paragraph']);
	});

	it('goes into the section the writing is already in', () => {
		const into = open(block({ content: section(...text('a thought')) }));
		into.commands.setTextSelection(into.state.doc.content.size - 2);
		into.commands.splitBlock();
		typeInto(into, '```mermaid ');
		expect(docBlocks(into.state.doc)).toHaveLength(1);
		expect(kinds(into)).toEqual(['paragraph', 'diagram', 'paragraph']);
	});
});

describe('a diagram in a note', () => {
	it('is drawn from the source, with the source beside it', async () => {
		open(
			block({
				content: section({ type: 'diagram', attrs: { language: 'mermaid', source: CHART } })
			})
		);
		await settle();
		expect(drawings.asked).toEqual([CHART]);
		expect(picture()?.querySelector('svg')).not.toBeNull();
		expect(source()?.value).toBe(CHART);
	});

	it('keeps what somebody types into that source', async () => {
		const into = open(
			block({ content: section({ type: 'diagram', attrs: { language: 'mermaid', source: '' } }) })
		);
		const field = source() as HTMLTextAreaElement;
		field.value = CHART;
		field.dispatchEvent(new Event('input'));
		expect(docBlocks(into.state.doc)[0].content.content[0].attrs).toEqual({
			language: 'mermaid',
			source: CHART
		});
	});

	it('shows the source, and says as much, for a language it does not draw', async () => {
		open(
			block({
				content: section({ type: 'diagram', attrs: { language: 'sequence', source: 'a -> b' } })
			})
		);
		await settle();
		expect(drawings.asked).toEqual([]);
		expect(picture()?.textContent).toBe('a -> b');
		expect(trouble()).toBe("This kind of diagram isn't drawn here.");
	});

	it('is a sentence about the diagram where the source will not draw', async () => {
		drawings.fails = true;
		open(
			block({
				content: section({ type: 'diagram', attrs: { language: 'mermaid', source: CHART } })
			})
		);
		await settle();
		expect(trouble().startsWith("This diagram didn't come out.")).toBe(true);
		expect(picture()?.querySelector('svg')).toBeNull();
	});

	// The sheet the note is written in closes on Escape too, and it listens on the
	// document: leaving the diagram must not cost the writer the note.
	it('lets nothing else have the Escape that leaves its source', () => {
		const heard: Event[] = [];
		const listen = (event: Event) => heard.push(event);
		document.addEventListener('keydown', listen);
		try {
			open(
				block({ content: section({ type: 'diagram', attrs: { language: 'mermaid', source: '' } }) })
			);
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
	it('is drawn without a source on a note nobody here can type into', async () => {
		element = document.createElement('div');
		document.body.append(element);
		editor = new Editor({
			element,
			editable: false,
			extensions: [StarterKit, DiagramNode],
			content: {
				type: 'doc',
				content: [{ type: 'diagram', attrs: { language: 'mermaid', source: CHART } }]
			}
		});
		await settle();
		expect(picture()?.querySelector('svg')).not.toBeNull();
		expect(source()).toBeNull();
	});

	it('reads back out of the note exactly as it was stored', () => {
		const stored = section(...text('how it goes'), {
			type: 'diagram',
			attrs: { language: 'mermaid', source: CHART }
		});
		const into = open(block({ content: stored }));
		expect(docBlocks(into.state.doc)[0].content).toEqual(stored);
	});

	it('carries a diagram it cannot read, and opens the rest of the note around it', () => {
		const into = open(
			block({ content: section({ type: 'diagram', attrs: { language: 'mermaid' } }) }),
			block({ content: section(...text('beside it')) })
		);
		expect(docBlocks(into.state.doc)).toHaveLength(1);
		expect(kinds(into)).toEqual(['paragraph']);
	});

	it('asks the renderer for nothing at all in a note holding no diagram', async () => {
		open(block({ content: section(...text('only words')) }));
		await settle();
		expect(drawings.asked).toEqual([]);
	});
});
