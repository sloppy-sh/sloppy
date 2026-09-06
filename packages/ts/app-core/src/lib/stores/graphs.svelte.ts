/**
 * The graphs a person keeps: the one they are in, the ones on the canvas beside
 * it, and the one writer over the API's graph routes.
 *
 * Which graph somebody is in and which they have put up beside it are this
 * device's view choices, so they live in the prefs store — DESIGN.md
 * § Persistence — and are read back through the listing, because a ref saved on
 * this device may belong to somebody who is no longer signed in.
 */

import { MAX_FIELDS } from '@sloppy/graph';
import {
	homeGraphRef,
	type GraphView,
	GraphViewSchema,
	type OwnedRef,
	type CreateGraphRequest,
	type UpdateGraphRequest
} from '@sloppy/types';
import { api } from '../api.js';
import { type DeviceArea, deviceStore } from '../device-store.js';
import { serverMessage } from './errors.js';
import { prefs } from './prefs.svelte.js';
import { session } from './session.svelte.js';

/** How many graphs may stand on one canvas at once. Past a handful the fields
 *  are further apart than a reader can hold in their head. */
export const MOST_ON_CANVAS = MAX_FIELDS;

export interface GraphsState {
	loading: boolean;
	/** True once a load has succeeded; stays true while a reload is in flight. */
	loaded: boolean;
	failed: boolean;
	/** The server's own words, where it gave any. */
	error?: string;
}

const IDLE: GraphsState = { loading: false, loaded: false, failed: false };

const LISTING = 'listing';

function kept(): DeviceArea | null {
	const did = session.viewer?.did;
	return did ? deviceStore.area(did, 'graphs') : null;
}

class GraphsStore {
	#all = $state<GraphView[]>([]);
	#state = $state<GraphsState>(IDLE);
	#inflight: Promise<GraphView[]> | null = null;
	// A {@link clear} that lands mid-request must not be undone by the answer:
	// nothing the previous person's graphs returns belongs to the next one.
	#epoch = 0;
	#restored: Promise<void> | null = null;
	/** The listing standing is the one this device kept, so an ask that will not
	 *  answer has nothing to report over it. */
	#asLastRead = false;

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

	/**
	 * The listing as this device last held it, so a saved canvas resolves before
	 * — or without — an answer. Idempotent, and never over an answer.
	 */
	restore(): Promise<void> {
		if (this.#restored) return this.#restored;
		const area = kept();
		if (!area) return Promise.resolve();
		const epoch = this.#epoch;
		this.#restored = (async () => {
			const held = await area.get<unknown[]>(LISTING);
			if (!held || epoch !== this.#epoch || this.#state.loaded || this.#all.length > 0) return;
			this.#all = held
				.map((row) => GraphViewSchema.safeParse(row))
				.filter((read) => read.success)
				.map((read) => read.data);
			this.#asLastRead = this.#all.length > 0;
		})().catch(() => {});
		return this.#restored;
	}

	/** Deduped and idempotent: every surface may call it on mount. */
	load(): Promise<GraphView[]> {
		void this.restore();
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
				this.#asLastRead = false;
				this.#state = { loading: false, loaded: true, failed: false };
				this.#keep();
				return list;
			})
			.catch(async (err: unknown) => {
				// Offline an ask can fail before the device has answered, and a
				// listing this device kept is not something to report a failure over.
				await this.restore();
				if (current()) {
					this.#state = this.#asLastRead
						? { loading: false, loaded: before.loaded, failed: false }
						: {
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
		this.#keep();
		this.enter(made.ref);
		return made;
	}

	async rename(ref: OwnedRef, request: UpdateGraphRequest): Promise<GraphView> {
		const epoch = this.#epoch;
		const named = await api.updateGraph(ref, request);
		if (epoch === this.#epoch) {
			this.#all = this.#all.map((graph) => (graph.ref === ref ? named : graph));
			this.#keep();
		}
		return named;
	}

	/** Move into a graph. One that was standing beside the graph being read
	 *  trades places with it: it becomes the one you are in, and the one you
	 *  were in comes down off the canvas. */
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

	/** After a sign-out or an erase: nothing cached belongs to the next person,
	 *  and a saved graph choice names the identity that kept it. */
	clear(): void {
		this.#epoch++;
		this.#all = [];
		this.#state = IDLE;
		this.#inflight = null;
		this.#restored = null;
		this.#asLastRead = false;
		prefs.set('graph', null);
		prefs.set('alsoOnCanvas', []);
	}

	#keep(): void {
		const area = kept();
		if (!area) return;
		void area.set(LISTING, $state.snapshot(this.#all)).catch(() => {});
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
