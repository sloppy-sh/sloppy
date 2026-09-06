/**
 * The tag axis: every tag the reader has used in a graph, and which of them the
 * canvas is lit by. One reader over the API's tag route.
 *
 * There is no tag row to cache — a tag exists exactly as long as a note carries
 * one — so this holds counts that go stale the moment a note is retagged, and
 * {@link TagsStore.reload} is how a surface asks again.
 *
 * The counts are per graph, because the rail is the legend for the canvas beside
 * it. The selection is not: a reader asks one question of whatever is on screen,
 * and it is persisted, so it lives in the prefs store.
 */

import { type OwnedRef, type Tag, type TagCount, TagCountSchema } from '@sloppy/types';
import { SvelteMap } from 'svelte/reactivity';
import { api } from '../api.js';
import { type DeviceArea, deviceStore } from '../device-store.js';
import { serverMessage } from './errors.js';
import { prefs } from './prefs.svelte.js';
import { session } from './session.svelte.js';

export interface TagsState {
	loading: boolean;
	loaded: boolean;
	failed: boolean;
	/** The server's own words, where it gave any. */
	error?: string;
}

const IDLE: TagsState = { loading: false, loaded: false, failed: false };

function kept(): DeviceArea | null {
	const did = session.viewer?.did;
	return did ? deviceStore.area(did, 'tags') : null;
}

class TagsStore {
	#byGraph = new SvelteMap<OwnedRef, TagCount[]>();
	#states = new SvelteMap<OwnedRef, TagsState>();
	#inflight = new Map<OwnedRef, Promise<TagCount[]>>();
	// A {@link clear} that lands mid-request must not be undone by the answer:
	// nothing the previous person's graph returns belongs to the next one.
	#epoch = 0;
	#restored = new Map<OwnedRef, Promise<void>>();

	/** Most-used first, which is the order the read answers in. */
	of(graph: OwnedRef): TagCount[] {
		return this.#byGraph.get(graph) ?? [];
	}

	/** The tags carried across every graph on the canvas, counted together —
	 *  what the rail beside that canvas is the legend for. */
	across(graphs: readonly OwnedRef[]): TagCount[] {
		if (graphs.length === 1) return this.of(graphs[0]);
		const counted: Record<string, number> = {};
		for (const graph of graphs) {
			for (const { tag, notes } of this.of(graph)) {
				counted[tag] = (counted[tag] ?? 0) + notes;
			}
		}
		return Object.entries(counted)
			.map(([tag, notes]) => ({ tag: tag as Tag, notes }))
			.sort((a, b) => b.notes - a.notes || a.tag.localeCompare(b.tag));
	}

	status(graph: OwnedRef): TagsState {
		return this.#states.get(graph) ?? IDLE;
	}

	/** In selection order — DESIGN.md § Hue reads the slots off that order. */
	get selected(): Tag[] {
		return prefs.current.tags;
	}

	select(tags: Tag[]): void {
		prefs.set('tags', tags);
	}

	/** The counts as this device last held them, so the rail is a legend before —
	 *  or without — an answer. Idempotent, and never over an answer. */
	restore(graph: OwnedRef): Promise<void> {
		const already = this.#restored.get(graph);
		if (already) return already;
		const area = kept();
		if (!area) return Promise.resolve();
		const epoch = this.#epoch;
		const reading = (async () => {
			const held = await area.get<unknown[]>(graph);
			if (!held || epoch !== this.#epoch || this.#byGraph.has(graph)) return;
			this.#byGraph.set(
				graph,
				held
					.map((row) => TagCountSchema.safeParse(row))
					.filter((read) => read.success)
					.map((read) => read.data)
			);
		})().catch(() => {});
		this.#restored.set(graph, reading);
		return reading;
	}

	/** Deduped and idempotent: every surface may call it on mount. */
	load(graph: OwnedRef): Promise<TagCount[]> {
		void this.restore(graph);
		const inflight = this.#inflight.get(graph);
		if (inflight) return inflight;
		if (this.status(graph).loaded) return Promise.resolve(this.of(graph));
		return this.reload(graph);
	}

	reload(graph: OwnedRef): Promise<TagCount[]> {
		const inflight = this.#inflight.get(graph);
		if (inflight) return inflight;
		const epoch = this.#epoch;
		const current = () => epoch === this.#epoch;
		const before = this.status(graph);
		this.#states.set(graph, { ...before, loading: true, failed: false, error: undefined });
		const request = api
			.listTags(graph)
			.then((list) => {
				if (!current()) return [];
				this.#byGraph.set(graph, list);
				this.#states.set(graph, { loading: false, loaded: true, failed: false });
				const area = kept();
				if (area) void area.set(graph, $state.snapshot(list)).catch(() => {});
				return list;
			})
			.catch((err: unknown) => {
				if (current()) {
					this.#states.set(graph, {
						loading: false,
						loaded: before.loaded,
						failed: true,
						error: serverMessage(err)
					});
				}
				throw err;
			})
			.finally(() => {
				if (current()) this.#inflight.delete(graph);
			});
		this.#inflight.set(graph, request);
		return request;
	}

	/** After a sign-out or an erase: nothing cached belongs to the next person. */
	clear(): void {
		this.#epoch++;
		this.#byGraph.clear();
		this.#states.clear();
		this.#inflight.clear();
		this.#restored.clear();
		this.select([]);
	}
}

export const tags = new TagsStore();
