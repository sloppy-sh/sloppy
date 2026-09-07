import 'fake-indexeddb/auto';
import type { InkStroke } from '@sloppy/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deviceStore } from '../device-store.js';
import { canvasInk } from './canvas-ink.svelte.js';
import { ref, useFakeApi, VIEWER } from './fake-api.test-support.js';
import { session } from './session.svelte.js';

const GRAPH = ref(1);
const OTHER = ref(2);

const stroke = (x: number): InkStroke => ({
	points: [
		{ x, y: 0, pressure: 0.5, t: 0 },
		{ x: x + 10, y: 20, pressure: 0.5, t: 8 }
	],
	width: 1.1
});

const at = (strokes: readonly InkStroke[]) => strokes.map((one) => one.points[0].x);

const area = () => deviceStore.area(VIEWER.did, 'canvas-ink');

beforeEach(async () => {
	// Nobody is signed in between cases, and an act while nobody is empties what
	// the case before left in memory.
	canvasInk.rubOut(GRAPH);
	const api = useFakeApi();
	api.on('GET /auth/me', () => VIEWER);
	await session.refresh();
	await deviceStore.forget(VIEWER.did);
});

afterEach(() => {
	session.clear();
});

describe('the drawing over a graph', () => {
	it('is the graph it was drawn over and no other', () => {
		canvasInk.add(GRAPH, stroke(0));
		canvasInk.add(GRAPH, stroke(100));
		canvasInk.add(OTHER, stroke(50));

		expect(at(canvasInk.strokes(GRAPH))).toEqual([0, 100]);
		expect(at(canvasInk.strokes(OTHER))).toEqual([50]);
	});

	it('gives back the last stroke, and then the whole drawing', () => {
		canvasInk.add(GRAPH, stroke(0));
		canvasInk.add(GRAPH, stroke(100));

		canvasInk.undo(GRAPH);
		expect(at(canvasInk.strokes(GRAPH))).toEqual([0]);

		canvasInk.rubOut(GRAPH);
		expect(canvasInk.strokes(GRAPH)).toEqual([]);
	});

	it('is on the device, so it is there when the graph is opened again', async () => {
		canvasInk.add(GRAPH, stroke(7));
		await expect(area().get(GRAPH)).resolves.toHaveLength(1);

		canvasInk.rubOut(GRAPH);
		await expect(area().get(GRAPH)).resolves.toBeUndefined();
	});

	it('comes back off the device when the graph opens', async () => {
		await area().set(GRAPH, [stroke(3), stroke(9)]);

		await canvasInk.restore(GRAPH);

		expect(at(canvasInk.strokes(GRAPH))).toEqual([3, 9]);
	});

	it('keeps a stroke drawn while what was kept was still being read', async () => {
		await area().set(GRAPH, [stroke(3)]);

		const reading = canvasInk.restore(GRAPH);
		canvasInk.add(GRAPH, stroke(99));
		await reading;

		expect(at(canvasInk.strokes(GRAPH))).toEqual([3, 99]);
		await expect(area().get(GRAPH)).resolves.toHaveLength(2);
	});

	it('drops what no longer reads as a stroke and keeps the rest', async () => {
		await area().set(GRAPH, [stroke(3), { points: [], width: 0 }, 'a scribble']);

		await canvasInk.restore(GRAPH);

		expect(at(canvasInk.strokes(GRAPH))).toEqual([3]);
	});

	it('belongs to one identity, and goes with them', async () => {
		canvasInk.add(GRAPH, stroke(0));

		session.clear();
		await canvasInk.restore(GRAPH);

		expect(canvasInk.strokes(GRAPH)).toEqual([]);
	});
});
