/**
 * The graph's node cache: one writer over the API's node routes, and the thing
 * the renderer and the node surface both read.
 *
 * Reads are served from the cache and filtered the way the API filters — a
 * region with no `origin` is the roots, not everything — so a node created or
 * edited anywhere shows up in every view of it without a refetch.
 *
 * What this device kept of the graph fills it before any answer arrives, and
 * an answer always wins over a kept row — DESIGN.md § Persistence.
 */

import {
	type Address,
	type CreateNodeRequest,
	graphOf,
	type NodeBulkRequest,
	type NodeBulkResult,
	type NodeView,
	NodeViewSchema,
	orderSiblings,
	type NoteDestination,
	type OwnedRef,
	type UpdateNodeRequest
} from '@sloppy/types';
import { SvelteMap } from 'svelte/reactivity';
import { api } from '../api.js';
import { type DeviceArea, deviceStore } from '../device-store.js';
import { runtime } from '../runtime.js';
import { serverMessage } from './errors.js';
import { session } from './session.svelte.js';

/** A region of one of the caller's graphs, exactly as `listNodes` takes it. */
export interface NodeRegion {
	/** Absent asks for the branches of `graph`. */
	origin?: OwnedRef;
	/** Absent asks for the whole tree under `origin`. */
	maxDepth?: number;
	/**
	 * Which graph the branches are of. Read only where there is no `origin` — a
	 * tree is in the graph its root is in — and absent there asks the caller's
	 * home graph, the way it does on the wire.
	 */
	graph?: OwnedRef;
}

/** A note asked for, whose address the server has yet to assign. */
export interface WritingNote {
	/** The note as the server wrote it. Rejects where it would not be written. */
	readonly note: Promise<NodeView>;
	/** A fresh trip for the same note, for a first one that was refused. */
	again(): WritingNote;
}

export interface RegionState {
	loading: boolean;
	/** True once a load has succeeded; stays true while a reload is in flight. */
	loaded: boolean;
	failed: boolean;
	/** The server's own words, where it gave any; the surface owes its own line
	 *  when this is absent. */
	error?: string;
}

const IDLE: RegionState = { loading: false, loaded: false, failed: false };

function regionKey(region: NodeRegion): string {
	return `${region.origin ?? ''} ${region.maxDepth ?? ''} ${region.origin ? '' : (region.graph ?? '')}`;
}

function inRegion(node: NodeView, { origin, maxDepth, graph }: NodeRegion): boolean {
	// A root is its own origin, so that equality IS the branches query.
	if (origin === undefined ? node.ref !== node.origin : node.origin !== origin) return false;
	if (origin === undefined && graph !== undefined && graphOf(node) !== graph) return false;
	return maxDepth === undefined || node.depth <= maxDepth;
}

/** Long enough for a field's branches to have landed, short enough that a tab
 *  closed straight after reading one costs at most the next read. */
const WRITE_AFTER = 200;

/** Kept under the graph each note is in, so one field's notes are read and
 *  written on their own — and under the folder they were read out of, since two
 *  folders on this device may hold one graph and neither one's notes are the
 *  other's. */
function kept(): DeviceArea | null {
	const did = session.viewer?.did;
	if (!did) return null;
	const folder = runtime.vault()?.folder();
	return deviceStore.area(did, folder === undefined ? 'notes' : `notes ${folder}`);
}

class NodesStore {
	#byRef = new SvelteMap<OwnedRef, NodeView>();
	#regions = new SvelteMap<string, RegionState>();
	#asked = new Map<string, NodeRegion>();
	#regionsInflight = new Map<string, Promise<NodeView[]>>();
	#nodesInflight = new Map<OwnedRef, Promise<NodeView | null>>();
	// A {@link clear} that lands mid-request must not be undone by the answer:
	// nothing the previous person's graph returns belongs to the next one.
	#epoch = 0;
	#restored: Promise<void> | null = null;
	/** Painted from what this device kept, and confirmed by no answer since. A
	 *  region that comes back without one is how a note deleted on another device
	 *  goes here too. */
	#unconfirmed = new Set<OwnedRef>();
	#behind = new Map<OwnedRef, DeviceArea>();
	#writing: ReturnType<typeof setTimeout> | null = null;

	#children = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- rebuilt whole by the derived, never mutated after; the derived IS the reactivity.
		const index = new Map<OwnedRef, NodeView[]>();
		for (const node of this.#byRef.values()) {
			if (!node.parent) continue;
			const siblings = index.get(node.parent);
			if (siblings) siblings.push(node);
			else index.set(node.parent, [node]);
		}
		for (const [key, siblings] of index) index.set(key, orderSiblings(siblings));
		return index;
	});

	get(ref: OwnedRef): NodeView | undefined {
		return this.#byRef.get(ref);
	}

	/** In the order every peer reads a run in — `orderSiblings`. */
	children(ref: OwnedRef): NodeView[] {
		return this.#children.get(ref) ?? [];
	}

	/** Cached nodes matching `region`, in the order a run reads. */
	region(region: NodeRegion = {}): NodeView[] {
		const out: NodeView[] = [];
		for (const node of this.#byRef.values()) {
			if (inRegion(node, region)) out.push(node);
		}
		return orderSiblings(out);
	}

	status(region: NodeRegion = {}): RegionState {
		return this.#regions.get(regionKey(region)) ?? IDLE;
	}

	/**
	 * Fill the cache with the graph as this device last held it, so a canvas can
	 * draw before — or without — an answer. Idempotent, and a row already known
	 * is never replaced by a kept one.
	 */
	restore(): Promise<void> {
		if (this.#restored) return this.#restored;
		const area = kept();
		if (!area) return Promise.resolve();
		const epoch = this.#epoch;
		this.#restored = (async () => {
			const fields = await area.keys();
			const held = await Promise.all(fields.map((graph) => area.get<unknown[]>(graph)));
			if (epoch !== this.#epoch) return;
			for (const row of held.flatMap((rows) => rows ?? [])) {
				const read = NodeViewSchema.safeParse(row);
				if (!read.success || this.#byRef.has(read.data.ref)) continue;
				if (this.#answeredFor(read.data)) continue;
				this.#byRef.set(read.data.ref, read.data);
				this.#unconfirmed.add(read.data.ref);
			}
		})().catch(() => {});
		return this.#restored;
	}

	/** Deduped: two surfaces asking for the same region issue one request, and a
	 *  region already loaded issues none. */
	load(region: NodeRegion = {}): Promise<NodeView[]> {
		void this.restore();
		const key = regionKey(region);
		const inflight = this.#regionsInflight.get(key);
		if (inflight) return inflight;
		if (this.#regions.get(key)?.loaded) return Promise.resolve(this.region(region));
		return this.reload(region);
	}

	/** Ask again regardless of what is cached. */
	reload(region: NodeRegion = {}): Promise<NodeView[]> {
		const key = regionKey(region);
		const inflight = this.#regionsInflight.get(key);
		if (inflight) return inflight;
		const before = this.#regions.get(key) ?? IDLE;
		const epoch = this.#epoch;
		const current = () => epoch === this.#epoch;
		this.#asked.set(key, region);
		this.#regions.set(key, { ...before, loading: true, failed: false, error: undefined });
		const request = api
			.listNodes(region)
			.then((list) => {
				if (!current()) return [];
				const answered = new Set(list.map((node) => node.ref));
				for (const node of list) this.#learn(node);
				for (const ref of [...this.#unconfirmed]) {
					const held = this.#byRef.get(ref);
					if (held && !answered.has(ref) && inRegion(held, region)) this.forget(ref);
				}
				this.#regions.set(key, { loading: false, loaded: true, failed: false });
				return this.region(region);
			})
			.catch((err: unknown) => {
				if (current()) {
					this.#regions.set(key, {
						loading: false,
						loaded: before.loaded,
						failed: true,
						error: serverMessage(err)
					});
				}
				throw err;
			})
			.finally(() => {
				if (current()) this.#regionsInflight.delete(key);
			});
		this.#regionsInflight.set(key, request);
		return request;
	}

	/**
	 * Every region asked for, read from the top, for a graph that has moved
	 * underneath the cache rather than been written to through it. A region's
	 * answer is the whole of it, so a note it no longer holds goes; a branch that
	 * arrived is read down, because nothing has ever asked for its tree.
	 */
	async readAgain(): Promise<void> {
		for (const ref of this.#byRef.keys()) this.#unconfirmed.add(ref);
		const asked = [...this.#asked.values()];
		await Promise.allSettled(asked.map((region) => this.reload(region)));
		const branches = asked
			.filter((region) => region.origin === undefined)
			.flatMap((region) => this.region(region));
		await Promise.allSettled(branches.map((root) => this.load({ origin: root.ref })));
	}

	/** One node, deduped against a concurrent ask for the same one. `null` where
	 *  it is gone, which a stale associative link expects. */
	fetch(ref: OwnedRef): Promise<NodeView | null> {
		const inflight = this.#nodesInflight.get(ref);
		if (inflight) return inflight;
		const epoch = this.#epoch;
		const current = () => epoch === this.#epoch;
		const request = api
			.getNode(ref)
			.then((node) => {
				if (!current()) return node;
				if (node) this.#learn(node);
				else this.forget(ref);
				return node;
			})
			.finally(() => {
				if (current()) this.#nodesInflight.delete(ref);
			});
		this.#nodesInflight.set(ref, request);
		return request;
	}

	/** Ask again for one node, even where an ask for it is already in flight: an
	 *  answer already on its way was read before whatever prompted this. */
	refetch(ref: OwnedRef): Promise<NodeView | null> {
		const inflight = this.#nodesInflight.get(ref);
		if (!inflight) return this.fetch(ref);
		const again = () => this.fetch(ref);
		return inflight.then(again, again);
	}

	/**
	 * Asks for a note and answers with the asking rather than with the note, so
	 * a surface can open on the tap. The trip outlives whatever asked for it:
	 * the cache learns the note whether or not that surface is still there.
	 */
	write(request: CreateNodeRequest): WritingNote {
		return {
			note: this.create(request),
			again: () => this.write(request)
		};
	}

	async create(request: CreateNodeRequest): Promise<NodeView> {
		const epoch = this.#epoch;
		const node = await api.createNode(request);
		if (epoch !== this.#epoch) return node;
		this.#learn(node);
		return node;
	}

	async update(ref: OwnedRef, request: UpdateNodeRequest): Promise<NodeView> {
		const epoch = this.#epoch;
		const node = await api.updateNode(ref, request);
		if (epoch === this.#epoch) this.#learn(node);
		return node;
	}

	/** Write the address a person cites this note by, or take it off with
	 *  `null`. Nothing else moves: an address is one note's own label. */
	async setAddress(ref: OwnedRef, address: Address | null): Promise<NodeView> {
		const epoch = this.#epoch;
		const node = await api.setAddress(ref, address);
		if (epoch === this.#epoch) this.#learn(node);
		return node;
	}

	/**
	 * Carry a note somewhere else, with everything that sprang from it. The
	 * answer is the whole subtree as it now stands, so the canvas and the outline
	 * re-derive from addresses that have already changed rather than from the
	 * ones they were drawn at.
	 *
	 * `address` is the label the person named for it; absent leaves it to the
	 * rule, which is the next address in the run the note joins.
	 */
	async move(ref: OwnedRef, to: NoteDestination, address?: Address): Promise<NodeView[]> {
		const epoch = this.#epoch;
		const moved = await api.moveNote(ref, to, address);
		if (epoch !== this.#epoch) return moved;
		for (const node of moved) this.#learn(node);
		return moved;
	}

	/** One act over however many notes somebody chose. */
	async act(request: NodeBulkRequest): Promise<NodeBulkResult> {
		const epoch = this.#epoch;
		const result = await api.actOnNodes(request);
		if (epoch !== this.#epoch) return result;
		if (request.act.act === 'delete') {
			// The missed ones are gone too, whether they went just now or earlier.
			for (const ref of request.notes) this.forget(ref);
		} else {
			for (const node of result.notes) this.#learn(node);
		}
		return result;
	}

	async remove(ref: OwnedRef): Promise<void> {
		const epoch = this.#epoch;
		await api.deleteNode(ref);
		if (epoch === this.#epoch) this.forget(ref);
	}

	/**
	 * Drop a node and everything that sprang from it. A note is gone with its
	 * descendants whether or not anybody numbered them, so the walk down is the
	 * parent chain; a shell that learned elsewhere the node is gone calls this
	 * directly.
	 */
	forget(ref: OwnedRef): void {
		const going = [ref];
		for (let at = 0; at < going.length; at += 1) {
			for (const node of this.#byRef.values()) {
				if (node.parent === going[at]) going.push(node.ref);
			}
			this.#drop(going[at]);
		}
	}

	/** After a sign-out or an erase: nothing cached belongs to the next person.
	 *  What the device kept is `session.signOut`'s to take, not this. */
	clear(): void {
		this.#epoch++;
		this.#byRef.clear();
		this.#regions.clear();
		this.#asked.clear();
		this.#regionsInflight.clear();
		this.#nodesInflight.clear();
		this.#unconfirmed.clear();
		this.#behind.clear();
		this.#restored = null;
	}

	/** A region that has answered already said which notes are in it, so a kept
	 *  row it left out is one that is gone — whichever landed first. */
	#answeredFor(node: NodeView): boolean {
		for (const [key, region] of this.#asked) {
			if (this.#regions.get(key)?.loaded && inRegion(node, region)) return true;
		}
		return false;
	}

	#learn(node: NodeView): void {
		this.#byRef.set(node.ref, node);
		this.#unconfirmed.delete(node.ref);
		this.#keep(graphOf(node));
	}

	#drop(ref: OwnedRef): void {
		const node = this.#byRef.get(ref);
		this.#byRef.delete(ref);
		this.#unconfirmed.delete(ref);
		if (node) this.#keep(graphOf(node));
	}

	/** Written once the answers stop arriving, because reading one field is many
	 *  regions landing on the same rows and each write is the whole field. */
	#keep(graph: OwnedRef): void {
		const area = kept();
		if (!area) return;
		this.#behind.set(graph, area);
		if (this.#writing) return;
		this.#writing = setTimeout(() => {
			this.#writing = null;
			const behind = [...this.#behind];
			this.#behind.clear();
			for (const [graph, area] of behind) {
				const rows = $state.snapshot(
					[...this.#byRef.values()].filter((node) => graphOf(node) === graph)
				);
				void (rows.length > 0 ? area.set(graph, rows) : area.delete(graph)).catch(() => {});
			}
		}, WRITE_AFTER);
	}
}

export const nodes = new NodesStore();
