// @vitest-environment jsdom
import type { GraphTransform } from '@sloppy/graph';
import type { InkStroke } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubResizeObserver } from '../dom.test-support.js';
import type { CanvasPen } from './canvas-ink.svelte';

/** What the drawing asked for, in the units it asked in: jsdom draws nothing,
 *  and where a stroke lands is what this file is about. */
interface Drawn {
	moved: { x: number; y: number }[];
	lined: { x: number; y: number }[];
	translated: { x: number; y: number }[];
	scaled: number[];
}

let drawn: Drawn;

function stubCanvas(): void {
	drawn = { moved: [], lined: [], translated: [], scaled: [] };
	HTMLCanvasElement.prototype.getContext = (() => ({
		lineCap: '',
		lineJoin: '',
		lineWidth: 0,
		strokeStyle: '',
		fillStyle: '',
		setTransform: () => {},
		clearRect: () => {},
		translate: (x: number, y: number) => drawn.translated.push({ x, y }),
		scale: (x: number) => drawn.scaled.push(x),
		beginPath: () => {},
		moveTo: (x: number, y: number) => drawn.moved.push({ x, y }),
		lineTo: (x: number, y: number) => drawn.lined.push({ x, y }),
		stroke: () => {},
		arc: () => {},
		fill: () => {}
	})) as unknown as HTMLCanvasElement['getContext'];
}

const Harness = (await import('./canvas-ink-harness.test.svelte')).default;

const LOOKING: GraphTransform = { x: 100, y: 50, scale: 2 };

const LINE: InkStroke = {
	points: [
		{ x: 0, y: 0, pressure: 0.5, t: 0 },
		{ x: 10, y: 20, pressure: 0.5, t: 1 }
	],
	width: 2
};

type Drive = (next: { transform?: GraphTransform; strokes?: InkStroke[] }) => void;

let target: HTMLElement;
let layer: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let pen: CanvasPen | undefined;
let drive: Drive;
let kept: InkStroke[];

function render(props: { transform?: GraphTransform; strokes?: InkStroke[] } = {}) {
	kept = [];
	pen = undefined;
	mounted = mount(Harness, {
		target,
		props: {
			layer,
			transform: LOOKING,
			ondrawn: (stroke: InkStroke) => kept.push(stroke),
			drive: (set: Drive) => {
				drive = set;
			},
			held: (next: CanvasPen | undefined) => {
				pen = next;
			},
			...props
		}
	});
	flushSync();
}

/** A pen sample, as the platform reports one. */
function nib(type: string, clientX: number, clientY: number) {
	return {
		type,
		clientX,
		clientY,
		pointerId: 1,
		pointerType: 'pen',
		pressure: 0.5,
		timeStamp: 0
	} as unknown as PointerEvent;
}

/** What the canvas resolves a client point to, at {@link LOOKING}. */
const world = (clientX: number, clientY: number) => ({
	x: (clientX - LOOKING.x) / LOOKING.scale,
	y: (clientY - LOOKING.y) / LOOKING.scale
});

/** Down, across, and lifted — the lift is a sample of its own, as it is
 *  everywhere else a pen is read. */
function stroke(from: [number, number], through: [number, number], to: [number, number]): void {
	pen?.(nib('pointerdown', ...from), world(...from));
	pen?.(nib('pointermove', ...through), world(...through));
	pen?.(nib('pointerup', ...to), world(...to));
	flushSync();
}

beforeEach(() => {
	stubResizeObserver();
	stubCanvas();
	target = document.createElement('div');
	layer = document.createElement('div');
	layer.getBoundingClientRect = () => ({ width: 800, height: 600 }) as DOMRect;
	document.body.append(target, layer);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	document.body.innerHTML = '';
});

describe('inking over the canvas', () => {
	it('draws into the layer the canvas hands back', () => {
		render();
		expect(layer.querySelector('canvas')).not.toBeNull();
	});

	// The field is what a stroke has to stay on, so what is kept is where the
	// marks are rather than where the screen was.
	it('keeps a stroke in the field coordinates the canvas resolved', () => {
		render();
		stroke([300, 250], [400, 250], [500, 250]);

		expect(kept).toHaveLength(1);
		expect(kept[0].points.map((point) => [point.x, point.y])).toEqual([
			[100, 100],
			[150, 100],
			[200, 100]
		]);
	});

	it('lays the nib down at the width it looks on screen', () => {
		render();
		stroke([300, 250], [400, 250], [500, 250]);

		expect(kept[0].width).toBeCloseTo(1.1);
	});

	it('draws what is kept where the field is looking', () => {
		render({ strokes: [LINE] });

		expect(drawn.translated.at(-1)).toEqual({ x: 100, y: 50 });
		expect(drawn.scaled.at(-1)).toBe(2);
		expect(drawn.moved.at(-1)).toEqual({ x: 0, y: 0 });
		expect(drawn.lined.at(-1)).toEqual({ x: 10, y: 20 });
	});

	it('follows the field through a pan and a zoom', () => {
		render({ strokes: [LINE] });

		drive({ transform: { x: -40, y: 12, scale: 0.5 } });
		flushSync();

		expect(drawn.translated.at(-1)).toEqual({ x: -40, y: 12 });
		expect(drawn.scaled.at(-1)).toBe(0.5);
		// The points are the field's, so a pan moves the layer and never them.
		expect(drawn.lined.at(-1)).toEqual({ x: 10, y: 20 });
	});

	// A canvas that has not said where it is looking cannot place a point, and a
	// stroke placed wrong is worse than one not taken.
	it('takes nothing until the canvas has said where it is looking', () => {
		render({ transform: undefined });
		stroke([300, 250], [400, 250], [500, 250]);

		expect(kept).toEqual([]);
	});
});
