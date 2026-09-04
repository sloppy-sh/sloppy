/**
 * The graphs a person keeps: the one they are in, the ones on the canvas beside
 * it, and the one writer over the API's graph routes.
 *
 * Which graph somebody is in and which they have put up beside it are this
 * device's view choices, so they live in the prefs store — DESIGN.md
 * § Persistence — and are read back through the listing, because a ref saved on
 * this device may belong to somebody who is no longer signed in.
 */

import {
	homeGraphRef,
	type GraphView,
	type OwnedRef,
	type CreateGraphRequest,
	type UpdateGraphRequest
} from '@sloppy/types';
import { api } from '../api.js';
import { serverMessage } from './errors.js';
import { prefs } from './prefs.svelte.js';
import { session } from './session.svelte.js';

/** How many graphs may stand on one canvas at once. Past a handful the fields
 *  are further apart than a reader can hold in their head — and `scene.ts` has
 *  as many names to write with. */
export const MOST_ON_CANVAS = 6;

export interface GraphsState {
	loading: boolean;
	/** True once a load has succeeded; stays true while a reload is in flight. */
	loaded: boolean;
	failed: boolean;
	/** The server's own words, where it gave any. */
	error?: string;
}

const IDLE: GraphsState = { loading: false, loaded: false, failed: false };

class GraphsStore {
	#all = $state<GraphView[]>([]);
	#state = $state<GraphsState>(IDLE);
	#inflight: Promise<GraphView[]> | null = null;
	// A {@link clear} that lands mid-request must not be undone by the answer:
	// nothing the previous person's graphs returns belongs to the next one.
	#epoch = 0;

	/** The one they started with first, which is the order the route answers in. */
	get all(): GraphView[] {
		return this.#all;
	}

	get state(): GraphsState {
		return this.#state;
	}

	/** True once a person has more than one, which is what makes the graph a
	 *  thing to say and to switch between at all. */
	get several(): boolean {
		return this.#all.length > 1;
	}

	/** The graph the reader is in: where a new note goes, and what a surface
	 *  naming none means. */
	get current(): OwnedRef {
		return this.held(prefs.current.graph) ?? this.home;
	}

	/** The graph somebody has before they open a second one. Answered off the
	 *  identity rather than the listing, so it is right before the first read. */
	get home(): OwnedRef {
		const did = session.viewer?.did;
		return did ? homeGraphRef(did) : ('' as OwnedRef);
	}

	/** Every graph on the canvas, the one the reader is in first. */
	get onCanvas(): OwnedRef[] {
		const also = prefs.current.alsoOnCanvas
			.map((ref) => this.held(ref))
			.filter((ref): ref is OwnedRef => ref !== null && ref !== this.current);
		return [this.current, ...new Set(also)].slice(0, MOST_ON_CANVAS);
	}

	/** The graphs on the canvas as the renderer names its fields. */
	get fields(): { ref: OwnedRef; title: string }[] {
		return this.onCanvas.map((ref) => ({ ref, title: this.titleOf(ref) }));
	}

	titleOf(ref: OwnedRef): string {
		return this.#all.find((graph) => graph.ref === ref)?.title ?? '';
	}

	/** Deduped and idempotent: every surface may call it on mount. */
	load(): Promise<GraphView[]> {
		if (this.#inflight) return this.#inflight;
		if (this.#state.loaded) return Promise.resolve(this.#all);
		return this.reload();
	}

	reload(): Promise<GraphView[]> {
		if (this.#inflight) return this.#inflight;
		const epoch = this.#epoch;
		const current = () => epoch === this.#epoch;
		const before = this.#state;
		this.#state = { ...before, loading: true, failed: false, error: undefined };
		const request = api
			.listGraphs()
			.then((list) => {
				if (!current()) return [];
				this.#all = list;
				this.#state = { loading: false, loaded: true, failed: false };
				return list;
			})
			.catch((err: unknown) => {
				if (current()) {
					this.#state = {
						loading: false,
						loaded: before.loaded,
						failed: true,
						error: serverMessage(err)
					};
				}
				throw err;
			})
			.finally(() => {
				if (current()) this.#inflight = null;
			});
		this.#inflight = request;
		return request;
	}

	/** A new graph, which the reader is then in. */
	async open(request: CreateGraphRequest): Promise<GraphView> {
		const epoch = this.#epoch;
		const made = await api.createGraph(request);
		if (epoch !== this.#epoch) return made;
		this.#all = [...this.#all, made];
		this.enter(made.ref);
		return made;
	}

	async rename(ref: OwnedRef, request: UpdateGraphRequest): Promise<GraphView> {
		const epoch = this.#epoch;
		const named = await api.updateGraph(ref, request);
		if (epoch === this.#epoch) {
			this.#all = this.#all.map((graph) => (graph.ref === ref ? named : graph));
		}
		return named;
	}

	/** Move into a graph. It leaves the canvas's other fields where they are, so
	 *  a reader reading two graphs stays reading two graphs. */
	enter(ref: OwnedRef): void {
		prefs.set('graph', ref);
		prefs.set(
			'alsoOnCanvas',
			prefs.current.alsoOnCanvas.filter((also) => also !== ref)
		);
	}

	/** Put another graph up beside the one being read, or take it back down. The
	 *  graph the reader is IN is never one of these — it is always on the canvas. */
	toggleOnCanvas(ref: OwnedRef): void {
		if (ref === this.current) return;
		const held = prefs.current.alsoOnCanvas;
		prefs.set(
			'alsoOnCanvas',
			held.includes(ref)
				? held.filter((also) => also !== ref)
				: [...held, ref].slice(-(MOST_ON_CANVAS - 1))
		);
	}

	/** True where a full canvas is what stops another graph going up. */
	get canvasFull(): boolean {
		return this.onCanvas.length >= MOST_ON_CANVAS;
	}

	/** After a sign-out or an erase: nothing cached belongs to the next person. */
	clear(): void {
		this.#epoch++;
		this.#all = [];
		this.#state = IDLE;
		this.#inflight = null;
	}

	/** A ref this person actually keeps, or `null`. A saved choice outlives the
	 *  person who made it, and a graph is one identity's. */
	private held(ref: OwnedRef | null): OwnedRef | null {
		if (ref === null) return null;
		if (ref === this.home) return ref;
		return this.#all.some((graph) => graph.ref === ref) ? ref : null;
	}
}

export const graphs = new GraphsStore();
