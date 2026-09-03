/**
 * The regions of somebody else's graph the reader holds a copy of. A region is
 * keyed by the publication it came from and carries the address its author gave
 * it, so which held notes it covers is answered from the address.
 * docs/ARCHITECTURE.md § "Federating the graph".
 */

import {
	addressDepth,
	isInSubtree,
	type NodeView,
	type OwnedRef,
	type PullView,
	splitOwnedRef
} from '@sloppy/types';
import { SvelteMap } from 'svelte/reactivity';
import { api } from '../api.js';

class PullsStore {
	#byRef = new SvelteMap<OwnedRef, PullView>();
	#inflight: Promise<PullView[]> | null = null;
	#loaded = $state(false);
	// A sign-out that lands mid-request must not be undone by its answer.
	#epoch = 0;

	get all(): PullView[] {
		return [...this.#byRef.values()];
	}

	get loaded(): boolean {
		return this.#loaded;
	}

	/** Deduped: every surface may call it on mount. A refusal is the caller's to
	 *  hold — a region nobody could list is one the reader does without. */
	load(): Promise<PullView[]> {
		if (this.#inflight) return this.#inflight;
		if (this.#loaded) return Promise.resolve(this.all);
		const epoch = this.#epoch;
		const current = () => epoch === this.#epoch;
		const request = api
			.listPulls()
			.then((held) => {
				if (!current()) return [];
				this.#byRef.clear();
				for (const pull of held) this.#byRef.set(pull.ref, pull);
				this.#loaded = true;
				return this.all;
			})
			.finally(() => {
				if (current()) this.#inflight = null;
			});
		this.#inflight = request;
		return request;
	}

	/**
	 * The held region this note came out of. Where several cover it, the
	 * nearest: a region rooted deeper is the one whose terms a reader chose.
	 */
	holding(note: NodeView): PullView | undefined {
		return this.all
			.filter(
				(pull) =>
					splitOwnedRef(pull.publication).did === note.created_by &&
					isInSubtree(pull.root_address, note.address)
			)
			.sort((a, b) => addressDepth(a.root_address) - addressDepth(b.root_address))
			.at(-1);
	}

	clear(): void {
		this.#epoch++;
		this.#byRef.clear();
		this.#inflight = null;
		this.#loaded = false;
	}
}

export const pulls = new PullsStore();
