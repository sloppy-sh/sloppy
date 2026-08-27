/**
 * The facet axis: the reader's label dimensions, and which one the graph is
 * currently coloured by. One writer over the API's label-dimension routes.
 *
 * The lens is persisted, so it lives in the prefs store; this store is where it
 * is READ, because only here is it known whether the saved dimension still
 * exists.
 */

import {
	type CreateLabelDimensionRequest,
	FACET_SLOT_COUNT,
	type FacetSlot,
	type LabelDimensionView,
	type OwnedRef,
	type UpdateLabelDimensionRequest
} from '@sloppy/types';
import { SvelteMap } from 'svelte/reactivity';
import { api } from '../api.js';
import { serverMessage } from './errors.js';
import { prefs } from './prefs.svelte.js';

const ALL_SLOTS = Array.from({ length: FACET_SLOT_COUNT }, (_, i) => (i + 1) as FacetSlot);

/**
 * DESIGN.md § Hue: a pin is honoured first, declaration order fills what is
 * left, and past eight the slots repeat. A pin chooses among the eight; it never
 * adds a ninth.
 */
function assignSlots(dimensions: readonly LabelDimensionView[]): Map<string, FacetSlot> {
	const pinned = new Set(dimensions.map((d) => d.color_slot).filter((s) => s !== undefined));
	const free = ALL_SLOTS.filter((s) => !pinned.has(s));
	const pool = free.length ? free : ALL_SLOTS;
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a pure function's return, rebuilt whole by the derived that calls it.
	const slots = new Map<string, FacetSlot>();
	let next = 0;
	for (const dimension of dimensions) {
		slots.set(dimension.name, dimension.color_slot ?? pool[next++ % pool.length]);
	}
	return slots;
}

class LabelsStore {
	#byRef = new SvelteMap<OwnedRef, LabelDimensionView>();
	#loading = $state(false);
	#loaded = $state(false);
	#error = $state<string | undefined>(undefined);
	#failed = $state(false);
	#inflight: Promise<LabelDimensionView[]> | null = null;
	// A {@link clear} that lands mid-request must not be undone by the answer:
	// nothing the previous person's graph returns belongs to the next one.
	#epoch = 0;

	/** In declaration order — the order DESIGN.md's default slot assignment
	 *  reads them in. */
	#ordered = $derived.by(() =>
		[...this.#byRef.values()].sort(
			(a, b) => a.created_at.localeCompare(b.created_at) || a.ref.localeCompare(b.ref)
		)
	);
	#slots = $derived.by(() => assignSlots(this.#ordered));

	get dimensions(): LabelDimensionView[] {
		return this.#ordered;
	}

	get loading(): boolean {
		return this.#loading;
	}

	get loaded(): boolean {
		return this.#loaded;
	}

	get failed(): boolean {
		return this.#failed;
	}

	/** The server's own words, where it gave any. */
	get error(): string | undefined {
		return this.#error;
	}

	/** The dimension the graph is coloured by, or `null` for the monochrome
	 *  graph. A saved lens whose dimension is gone reads as none. */
	get lens(): LabelDimensionView | null {
		const name = prefs.current.lens;
		if (!name) return null;
		return this.#ordered.find((d) => d.name === name) ?? null;
	}

	setLens(name: string | null): void {
		prefs.set('lens', name);
	}

	/** `undefined` for a dimension this reader does not have. */
	slotFor(name: string): FacetSlot | undefined {
		return this.#slots.get(name);
	}

	byName(name: string): LabelDimensionView | undefined {
		return this.#ordered.find((d) => d.name === name);
	}

	/** Deduped and idempotent: every surface may call it on mount. */
	load(): Promise<LabelDimensionView[]> {
		if (this.#inflight) return this.#inflight;
		if (this.#loaded) return Promise.resolve(this.#ordered);
		return this.reload();
	}

	reload(): Promise<LabelDimensionView[]> {
		if (this.#inflight) return this.#inflight;
		const epoch = this.#epoch;
		const current = () => epoch === this.#epoch;
		this.#loading = true;
		this.#failed = false;
		this.#error = undefined;
		const request = api
			.listLabelDimensions()
			.then((list) => {
				if (!current()) return [];
				this.#byRef.clear();
				for (const dimension of list) this.#byRef.set(dimension.ref, dimension);
				this.#loaded = true;
				return this.#ordered;
			})
			.catch((err: unknown) => {
				if (current()) {
					this.#failed = true;
					this.#error = serverMessage(err);
				}
				throw err;
			})
			.finally(() => {
				if (!current()) return;
				this.#loading = false;
				this.#inflight = null;
			});
		this.#inflight = request;
		return request;
	}

	async create(request: CreateLabelDimensionRequest): Promise<LabelDimensionView> {
		const epoch = this.#epoch;
		const dimension = await api.createLabelDimension(request);
		if (epoch === this.#epoch) this.#byRef.set(dimension.ref, dimension);
		return dimension;
	}

	/**
	 * Renaming a dimension rewrites the key on every node carrying it, and the
	 * API owns that sweep — so a rename leaves the node cache stale and the
	 * caller reloads the region it is showing.
	 */
	async update(ref: OwnedRef, request: UpdateLabelDimensionRequest): Promise<LabelDimensionView> {
		const epoch = this.#epoch;
		const before = this.#byRef.get(ref);
		const dimension = await api.updateLabelDimension(ref, request);
		if (epoch !== this.#epoch) return dimension;
		this.#byRef.set(dimension.ref, dimension);
		if (before && prefs.current.lens === before.name && before.name !== dimension.name) {
			this.setLens(dimension.name);
		}
		return dimension;
	}

	async remove(ref: OwnedRef): Promise<void> {
		const epoch = this.#epoch;
		const dimension = this.#byRef.get(ref);
		await api.deleteLabelDimension(ref);
		if (epoch !== this.#epoch) return;
		this.#byRef.delete(ref);
		if (dimension && prefs.current.lens === dimension.name) this.setLens(null);
	}

	/** After a sign-out or an erase: nothing cached belongs to the next person. */
	clear(): void {
		this.#epoch++;
		this.#byRef.clear();
		this.#loaded = false;
		this.#loading = false;
		this.#failed = false;
		this.#error = undefined;
		this.#inflight = null;
	}
}

export const labels = new LabelsStore();
