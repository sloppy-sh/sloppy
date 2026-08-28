// @vitest-environment jsdom
import type { InkStroke } from '@sloppy/types';
import type { Editor } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubResizeObserver } from '../dom.test-support.js';
import { docBlocks } from './document.js';
import { block, makeEditor, section, stubCanvas } from './editor.test-support.js';
import { StrokeInProgress, nibWidth, strokeBounds, translateStrokes } from './ink.js';

const SURFACE = { left: 100, top: 50, scale: 1 };

interface PenSample {
	x: number;
	y: number;
	pressure?: number;
	tiltX?: number;
	tiltY?: number;
	at?: number;
	type?: string;
	coalesced?: PenSample[];
}

/** A PointerEvent as a pen reports one, including the samples Safari merges. */
function pen(sample: PenSample): PointerEvent {
	const event = new Event(sample.type ?? 'pointermove', { bubbles: true, cancelable: true });
	const carried = {
		pointerId: 1,
		pointerType: 'pen',
		clientX: sample.x,
		clientY: sample.y,
		pressure: sample.pressure ?? 0.5,
		tiltX: sample.tiltX ?? 0,
		tiltY: sample.tiltY ?? 0,
		getCoalescedEvents: sample.coalesced
			? () => sample.coalesced!.map((one) => pen({ ...one, type: sample.type }))
			: undefined
	};
	Object.assign(event, carried);
	Object.defineProperty(event, 'timeStamp', { value: sample.at ?? 0 });
	return event as PointerEvent;
}

describe('a stroke as the pen reports it', () => {
	it('records where, how hard, how far over and how long since it began', () => {
		const stroke = new StrokeInProgress(
			pen({ x: 110, y: 60, pressure: 0.2, tiltX: 30, tiltY: -12, at: 1000, type: 'pointerdown' }),
			SURFACE,
			2
		);
		stroke.extend(pen({ x: 130, y: 70, pressure: 0.9, at: 1016 }), SURFACE);
		expect(stroke.points).toEqual([
			{ x: 10, y: 10, pressure: 0.2, tilt_x: 30, tilt_y: -12, t: 0 },
			{ x: 30, y: 20, pressure: 0.9, t: 16 }
		]);
	});

	it('keeps every sample the platform merged into one move', () => {
		const stroke = new StrokeInProgress(pen({ x: 100, y: 50, type: 'pointerdown' }), SURFACE, 2);
		stroke.extend(
			pen({
				x: 140,
				y: 50,
				at: 8,
				coalesced: [
					{ x: 110, y: 50, pressure: 0.3, at: 2 },
					{ x: 120, y: 50, pressure: 0.5, at: 4 },
					{ x: 140, y: 50, pressure: 0.8, at: 8 }
				]
			}),
			SURFACE
		);
		expect(stroke.points.map((p) => p.x)).toEqual([0, 10, 20, 40]);
		expect(stroke.points.map((p) => p.pressure)).toEqual([0.5, 0.3, 0.5, 0.8]);
	});

	it('falls back to the one sample where the platform reports no merged ones', () => {
		const stroke = new StrokeInProgress(pen({ x: 100, y: 50, type: 'pointerdown' }), SURFACE, 2);
		stroke.extend(pen({ x: 160, y: 50, at: 8 }), SURFACE);
		expect(stroke.points.map((p) => p.x)).toEqual([0, 60]);
	});

	it('reads a contact with no pressure sensor as a held, middling one', () => {
		const stroke = new StrokeInProgress(
			pen({ x: 100, y: 50, pressure: 0, type: 'pointerdown' }),
			SURFACE,
			2
		);
		expect(stroke.points[0].pressure).toBe(0.5);
	});

	it('scales the capture surface into the block the drawing is stored at', () => {
		const stroke = new StrokeInProgress(
			pen({ x: 200, y: 150, type: 'pointerdown' }),
			{ left: 100, top: 50, scale: 2 },
			2
		);
		expect(stroke.points[0]).toMatchObject({ x: 200, y: 200 });
	});
});

describe('how wide the mark is', () => {
	it('grows with pressure', () => {
		const light = nibWidth(2, { pressure: 0.1 });
		const heavy = nibWidth(2, { pressure: 0.95 });
		expect(heavy).toBeGreaterThan(light * 2);
	});

	it('broadens as the pen is laid over', () => {
		expect(nibWidth(2, { pressure: 0.5, tilt_x: 80 })).toBeGreaterThan(
			nibWidth(2, { pressure: 0.5 })
		);
	});
});

describe('placing a drawing', () => {
	const stroke: InkStroke = {
		points: [
			{ x: 40, y: 120, pressure: 0.5, t: 0 },
			{ x: 90, y: 200, pressure: 0.5, t: 10 }
		],
		width: 2
	};

	it('bounds a stroke by the mark it leaves, not by its centre line', () => {
		const bounds = strokeBounds([stroke])!;
		expect(bounds.left).toBeLessThan(40);
		expect(bounds.bottom).toBeGreaterThan(200);
	});

	it('moves a stroke without changing anything else about it', () => {
		const [moved] = translateStrokes([stroke], 0, -100);
		expect(moved.points.map((p) => p.y)).toEqual([20, 100]);
		expect(moved.points[0].pressure).toBe(0.5);
		expect(moved.width).toBe(2);
	});
});

describe('drawing into a drawing that is already there', () => {
	let editor: Editor | undefined;

	/** A section holding one drawing, and what that drawing holds afterwards. */
	const drawing = () => makeEditor([block({ content: blank() })]).editor;
	const blank = () => section({ type: 'ink', attrs: { strokes: [], width: 300, height: 100 } });
	const drawn = (of: Editor) =>
		docBlocks(of.state.doc)[0].content.content[0].attrs as {
			strokes: InkStroke[];
			height: number;
		};

	beforeEach(() => {
		stubResizeObserver();
		stubCanvas();
		Element.prototype.getBoundingClientRect = () =>
			({ left: 100, top: 50, width: 300, height: 100, right: 400, bottom: 150 }) as DOMRect;
	});

	afterEach(() => {
		editor?.destroy();
		editor = undefined;
		document.body.innerHTML = '';
	});

	function canvasOf(of: Editor): HTMLCanvasElement {
		const canvas = of.view.dom.parentElement!.querySelector('canvas');
		if (!canvas) throw new Error('the drawing has no surface');
		return canvas as HTMLCanvasElement;
	}

	function draw(canvas: HTMLCanvasElement, samples: PenSample[]): void {
		canvas.dispatchEvent(pen({ ...samples[0], type: 'pointerdown' }));
		for (const sample of samples.slice(1)) canvas.dispatchEvent(pen(sample));
		canvas.dispatchEvent(pen({ ...samples[samples.length - 1], type: 'pointerup' }));
	}

	it('adds what the pen drew to the drawing, pressure and all', () => {
		editor = drawing();
		draw(canvasOf(editor), [
			{ x: 110, y: 60, pressure: 0.2, at: 0 },
			{ x: 150, y: 90, pressure: 0.7, at: 16 },
			{ x: 200, y: 120, pressure: 0.95, at: 32 }
		]);

		const { strokes } = drawn(editor);
		expect(strokes).toHaveLength(1);
		expect(strokes[0].points.map((p) => p.pressure)).toEqual([0.2, 0.7, 0.95]);
		expect(strokes[0].points.map((p) => p.x)).toEqual([10, 50, 100]);
	});

	it('lets a finger past, so the page still scrolls over a drawing', () => {
		editor = drawing();
		const canvas = canvasOf(editor);
		const touch = (type: string, x: number) => {
			const event = pen({ x, y: 60, type });
			Object.assign(event, { pointerType: 'touch' });
			canvas.dispatchEvent(event);
		};
		touch('pointerdown', 110);
		touch('pointermove', 180);
		touch('pointerup', 180);

		expect(drawn(editor).strokes).toHaveLength(0);
	});

	it('grows the drawing when the pen runs past the bottom of it', () => {
		editor = drawing();
		draw(canvasOf(editor), [
			{ x: 110, y: 60, at: 0 },
			{ x: 150, y: 149, at: 16 }
		]);
		expect(drawn(editor).height).toBeGreaterThan(100);
	});
});
