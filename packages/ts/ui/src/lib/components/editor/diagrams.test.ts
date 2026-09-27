// @vitest-environment jsdom
//
// The real renderer, not stood in for: what this suite is about is WHERE it
// draws, and a stand-in draws wherever it is told.
import { beforeEach, describe, expect, it } from 'vitest';
import { NOT_DRAWN, drawDiagram, drawsDiagrams, troubleWithDiagram } from './diagrams.js';

/** Read as no diagram at all, so the renderer gives up before it draws. */
const UNREADABLE = 'this is not a diagram at all';

/** Read as a flowchart. jsdom lays out no SVG, so the renderer gives up part
 *  of the way through drawing it — the other side of the same promise. */
const CHART = 'graph TD; A-->B;';

beforeEach(() => {
	document.body.innerHTML = '';
});

describe('drawing a diagram', () => {
	it('leaves the page as it found it where the source cannot be read', async () => {
		await expect(drawDiagram('mermaid', UNREADABLE)).rejects.toThrow();
		expect(document.body.innerHTML).toBe('');
	});

	it('leaves the page as it found it where the drawing gives out part-way', async () => {
		await drawDiagram('mermaid', CHART).catch(() => undefined);
		expect(document.body.innerHTML).toBe('');
	});

	it('stacks nothing up over three that will not draw', async () => {
		for (const source of ['one', 'two', 'three']) {
			await drawDiagram('mermaid', source).catch(() => undefined);
		}
		expect(document.body.childNodes).toHaveLength(0);
	});

	it('draws no language it has no renderer for', async () => {
		expect(drawsDiagrams('plantuml')).toBe(false);
		await expect(drawDiagram('plantuml', '@startuml')).rejects.toThrow();
		expect(document.body.innerHTML).toBe('');
	});
});

describe('asking what is wrong with a diagram', () => {
	it('answers in the words of whatever read it, and draws nothing into the page', async () => {
		const trouble = await troubleWithDiagram('mermaid', UNREADABLE);
		expect(trouble).toBeTruthy();
		expect(trouble).not.toBe(NOT_DRAWN);
		expect(trouble).toContain(UNREADABLE);
		expect(document.body.innerHTML).toBe('');
	});

	it('has nothing to say about a diagram nobody has written into yet', async () => {
		expect(await troubleWithDiagram('mermaid', '  \n  ')).toBeUndefined();
	});

	it('has nothing to say about a language this build does not draw', async () => {
		expect(await troubleWithDiagram('plantuml', 'whatever this is')).toBeUndefined();
	});
});
