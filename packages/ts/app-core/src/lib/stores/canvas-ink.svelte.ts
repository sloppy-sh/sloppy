// What a pen left over the canvas, kept against the graph it was drawn on —
// DESIGN.md § "The canvas". A per-device view choice like the ground and the
// picture behind it: nothing here is on a note and nothing here reaches a peer.

import { type InkStroke, InkStrokeSchema, type OwnedRef } from '@sloppy/types';
import { SvelteMap } from 'svelte/reactivity';
import { type DeviceArea, deviceStore } from '../device-store.js';
import { session } from './session.svelte.js';

const AREA = 'canvas-ink';
const NONE: readonly InkStroke[] = [];

function kept(): DeviceArea | null {
	const did = session.viewer?.did;
	return did ? deviceStore.area(did, AREA) : null;
}

/** A stroke that no longer parses is dropped rather than taking the drawing
 *  around it with it. */
function strokesIn(value: unknown): InkStroke[] {
	if (!Array.isArray(value)) return [];
	const out: InkStroke[] = [];
	for (const entry of value) {
		const parsed = InkStrokeSchema.safeParse(entry);
		if (parsed.success) out.push(parsed.data);
	}
	return out;
}

class CanvasInkStore {
	readonly #byGraph = new SvelteMap<OwnedRef, InkStroke[]>();
	readonly #reading = new Map<OwnedRef, Promise<void>>();
	#held: string | null = null;

	/** In the field's own coordinates, oldest first. */
	strokes(graph: OwnedRef): readonly InkStroke[] {
		return this.#byGraph.get(graph) ?? NONE;
	}

	/** What this device kept for one graph. Idempotent, and it never takes back a
	 *  stroke drawn while it was being read. */
	restore(graph: OwnedRef): Promise<void> {
		this.#theirsAlone();
		const reading = this.#reading.get(graph);
		if (reading) return reading;
		const trip = this.#read(graph).catch(() => undefined);
		this.#reading.set(graph, trip);
		return trip;
	}

	add(graph: OwnedRef, stroke: InkStroke): void {
		this.#theirsAlone();
		this.#byGraph.set(graph, [...this.strokes(graph), stroke]);
		this.#keep(graph);
	}

	undo(graph: OwnedRef): void {
		this.#theirsAlone();
		const strokes = this.#byGraph.get(graph);
		if (!strokes || strokes.length === 0) return;
		this.#byGraph.set(graph, strokes.slice(0, -1));
		this.#keep(graph);
	}

	clear(graph: OwnedRef): void {
		this.#theirsAlone();
		if (!this.#byGraph.has(graph)) return;
		this.#byGraph.delete(graph);
		this.#keep(graph);
	}

	async #read(graph: OwnedRef): Promise<void> {
		const held = strokesIn(await kept()?.get(graph));
		if (held.length === 0) return;
		const drawn = this.#byGraph.get(graph);
		this.#byGraph.set(graph, drawn ? [...held, ...drawn] : held);
		if (drawn) this.#keep(graph);
	}

	#keep(graph: OwnedRef): void {
		const area = kept();
		if (!area) return;
		const strokes = this.#byGraph.get(graph);
		const written = strokes?.length ? area.set(graph, strokes) : area.delete(graph);
		void written.catch(() => undefined);
	}

	/** Every key here is one identity's, so nothing the last person drew is put
	 *  in front of whoever signs in next. */
	#theirsAlone(): void {
		const did = session.viewer?.did ?? null;
		if (did === this.#held) return;
		this.#held = did;
		this.#byGraph.clear();
		this.#reading.clear();
	}
}

export const canvasInk = new CanvasInkStore();
