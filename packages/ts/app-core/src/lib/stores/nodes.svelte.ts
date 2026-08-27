/**
 * The graph's node cache: one writer over the API's node routes, and the thing
 * the renderer and the node surface both read.
 *
 * Reads are served from the cache and filtered the way the API filters — a
 * region with no `origin` is the roots, not everything — so a node created or
 * edited anywhere shows up in every view of it without a refetch.
 */

import {
	compareAddresses,
	type CreateNodeRequest,
	isAncestorAddress,
	type NodeView,
	type OwnedRef,
	type UpdateNodeRequest
} from '@sloppy/types';
import { SvelteMap } from 'svelte/reactivity';
import { api } from '../api.js';
import { serverMessage } from './errors.js';

/** A region of the caller's own graph, exactly as `listNodes` takes it. */
export interface NodeRegion {
	/** Absent asks for the roots. */
	origin?: OwnedRef;
	/** Absent asks for the whole tree under `origin`. */
	maxDepth?: number;
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
	return `${region.origin ?? ''} ${region.maxDepth ?? ''}`;
}

const byAddress = (a: NodeView, b: NodeView) => compareAddresses(a.address, b.address);

class NodesStore {
	#byRef = new SvelteMap<OwnedRef, NodeView>();
	#regions = new SvelteMap<string, RegionState>();
	#regionsInflight = new Map<string, Promise<NodeView[]>>();
	#nodesInflight = new Map<OwnedRef, Promise<NodeView | null>>();
	// A {@link clear} that lands mid-request must not be undone by the answer:
	// nothing the previous person's graph returns belongs to the next one.
	#epoch = 0;

	#children = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- rebuilt whole by the derived, never mutated after; the derived IS the reactivity.
		const index = new Map<OwnedRef, NodeView[]>();
		for (const node of this.#byRef.values()) {
			if (!node.parent) continue;
			const siblings = index.get(node.parent);
			if (siblings) siblings.push(node);
			else index.set(node.parent, [node]);
		}
		for (const siblings of index.values()) siblings.sort(byAddress);
		return index;
	});

	get(ref: OwnedRef): NodeView | undefined {
		return this.#byRef.get(ref);
	}

	/** In address order, which is the order every peer reads them in. */
	children(ref: OwnedRef): NodeView[] {
		return this.#children.get(ref) ?? [];
	}

	/** Cached nodes matching `region`, in address order. */
	region(region: NodeRegion = {}): NodeView[] {
		const { origin, maxDepth } = region;
		const out: NodeView[] = [];
		for (const node of this.#byRef.values()) {
			// A root is its own origin, so that equality IS the roots query.
			if (origin === undefined ? node.ref !== node.origin : node.origin !== origin) continue;
			if (maxDepth !== undefined && node.depth > maxDepth) continue;
			out.push(node);
		}
		return out.sort(byAddress);
	}

	status(region: NodeRegion = {}): RegionState {
		return this.#regions.get(regionKey(region)) ?? IDLE;
	}

	/** Deduped: two surfaces asking for the same region issue one request, and a
	 *  region already loaded issues none. */
	load(region: NodeRegion = {}): Promise<NodeView[]> {
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
		this.#regions.set(key, { ...before, loading: true, failed: false, error: undefined });
		const request = api
			.listNodes(region)
			.then((list) => {
				if (!current()) return [];
				for (const node of list) this.#byRef.set(node.ref, node);
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
				if (node) this.#byRef.set(node.ref, node);
				else this.forget(ref);
				return node;
			})
			.finally(() => {
				if (current()) this.#nodesInflight.delete(ref);
			});
		this.#nodesInflight.set(ref, request);
		return request;
	}

	async create(request: CreateNodeRequest): Promise<NodeView> {
		const node = await api.createNode(request);
		this.#byRef.set(node.ref, node);
		return node;
	}

	async update(ref: OwnedRef, request: UpdateNodeRequest): Promise<NodeView> {
		const node = await api.updateNode(ref, request);
		this.#byRef.set(node.ref, node);
		return node;
	}

	async remove(ref: OwnedRef): Promise<void> {
		await api.deleteNode(ref);
		this.forget(ref);
	}

	/**
	 * Drop a node and its descendants from the cache. A child's address is
	 * derived from its parent's, so a subtree cannot outlive its root; a shell
	 * that learned elsewhere the node is gone calls this directly.
	 */
	forget(ref: OwnedRef): void {
		const node = this.#byRef.get(ref);
		this.#byRef.delete(ref);
		if (!node) return;
		for (const other of [...this.#byRef.values()]) {
			if (other.origin === node.origin && isAncestorAddress(node.address, other.address)) {
				this.#byRef.delete(other.ref);
			}
		}
	}

	/** After a sign-out or an erase: nothing cached belongs to the next person. */
	clear(): void {
		this.#epoch++;
		this.#byRef.clear();
		this.#regions.clear();
		this.#regionsInflight.clear();
		this.#nodesInflight.clear();
	}
}

export const nodes = new NodesStore();
