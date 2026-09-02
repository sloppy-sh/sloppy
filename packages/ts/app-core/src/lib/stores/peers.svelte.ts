/**
 * Other people's graphs: who the reader follows, what those identities publish,
 * and the regions of them this reader holds a copy of. One writer over the
 * API's peer routes, and the thing the canvas reads a foreign region from.
 *
 * Every request here is made by the API on the reader's behalf, so nothing in
 * this file reaches another instance — docs/ARCHITECTURE.md § "Federating the
 * graph".
 */

import type { FollowedIdentity, NodeView, OwnedRef, PublishedIndex, PullView } from '@sloppy/types';
import { SvelteMap } from 'svelte/reactivity';
import { api } from '../api.js';
import { serverMessage } from './errors.js';
import { session } from './session.svelte.js';

/** What a region is asked for by. `sourceUrl` absent asks this instance, which
 *  is the whole of it for somebody whose graph is kept here. */
export interface PullAsk {
	did: string;
	rootAddress: string;
	sourceUrl?: string;
}

class PeersStore {
	#following = $state<FollowedIdentity[]>([]);
	#regions = $state<PullView[]>([]);
	#held = new SvelteMap<OwnedRef, NodeView[]>();
	#busy = $state(false);
	#says = $state<string | null>(null);
	#loaded = false;
	/** Nothing held belongs to whoever signs in next. */
	#reader: string | null = null;

	get following(): FollowedIdentity[] {
		return this.#following;
	}

	get regions(): PullView[] {
		return this.#regions;
	}

	get busy(): boolean {
		return this.#busy;
	}

	/** Why the last thing asked for did not happen. */
	get says(): string | null {
		return this.#says;
	}

	region(ref: OwnedRef): PullView | undefined {
		return this.#regions.find((held) => held.ref === ref);
	}

	/** A held region's notes, in address order — empty until {@link enter}. */
	held(ref: OwnedRef): NodeView[] {
		return this.#held.get(ref) ?? [];
	}

	/** Who the reader follows and what they hold. Idempotent; every surface may
	 *  call it on mount. */
	async load(): Promise<void> {
		this.#forReader();
		if (this.#loaded) return;
		await this.attempt(async () => {
			const [following, regions] = await Promise.all([api.following(), api.listPulls()]);
			this.#following = following;
			this.#regions = regions;
			this.#loaded = true;
			return true;
		}, 'Sloppy could not read who you follow. Try again in a moment.');
	}

	async follow(did: string): Promise<boolean> {
		const done = await this.attempt(async () => {
			await api.follow({ did });
			this.#following = await api.following();
			return true;
		}, 'Sloppy could not follow them. Try again in a moment.');
		return done ?? false;
	}

	async unfollow(did: string): Promise<boolean> {
		const done = await this.attempt(async () => {
			await api.unfollow(did);
			this.#following = this.#following.filter((one) => one.did !== did);
			return true;
		}, 'Sloppy could not stop following them. Try again in a moment.');
		return done ?? false;
	}

	/** One page of what somebody publishes on an instance. `null` where the ask
	 *  did not land, with {@link says} carrying why. */
	publishedBy(
		did: string,
		options: { sourceUrl?: string; cursor?: string } = {}
	): Promise<PublishedIndex | null> {
		return this.attempt(
			() => api.publishedBy(did, options),
			'Sloppy could not read what they publish. Try again in a moment.'
		);
	}

	/** Take a region, or refresh the one already held at that address. */
	pull(ask: PullAsk): Promise<PullView | null> {
		return this.attempt(async () => {
			const held = await api.pullSubtree(ask.did, ask.rootAddress, ask.sourceUrl);
			this.#regions = await api.listPulls();
			this.#held.delete(held.ref);
			return held;
		}, 'Sloppy could not read that branch. Try again in a moment.');
	}

	async drop(ref: OwnedRef): Promise<boolean> {
		const done = await this.attempt(async () => {
			await api.dropPull(ref);
			this.#regions = this.#regions.filter((held) => held.ref !== ref);
			this.#held.delete(ref);
			return true;
		}, 'Sloppy could not let that region go. Try again in a moment.');
		return done ?? false;
	}

	/** A region's notes, read once and held for the session. */
	async enter(ref: OwnedRef): Promise<NodeView[]> {
		if (this.#held.has(ref)) return this.held(ref);
		const held = await this.attempt(
			() => api.listPulledNodes(ref),
			'Sloppy could not read that region. Try again in a moment.'
		);
		if (held) this.#held.set(ref, held);
		return this.held(ref);
	}

	private async attempt<T>(work: () => Promise<T>, failure: string): Promise<T | null> {
		this.#busy = true;
		this.#says = null;
		try {
			return await work();
		} catch (error) {
			this.#says = serverMessage(error) ?? failure;
			return null;
		} finally {
			this.#busy = false;
		}
	}

	#forReader(): void {
		const reader = session.viewer?.did ?? null;
		if (reader === this.#reader) return;
		this.#reader = reader;
		this.#following = [];
		this.#regions = [];
		this.#held.clear();
		this.#says = null;
		this.#loaded = false;
	}
}

export const peers = new PeersStore();
