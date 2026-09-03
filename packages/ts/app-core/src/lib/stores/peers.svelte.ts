/**
 * Other people's graphs: who the reader follows, what those identities publish,
 * and the regions of them this reader holds a copy of. One writer over the
 * API's peer routes, and the thing the canvas reads a foreign region from.
 *
 * Every request here is made by the API on the reader's behalf, so nothing in
 * this file reaches another instance — docs/ARCHITECTURE.md § "Federating the
 * graph".
 */

import type {
	BlockView,
	FollowedIdentity,
	NodeView,
	OwnedRef,
	PublishedIndex,
	PublishedIndexReader,
	PullView
} from '@sloppy/types';
import { publishedIndexReader } from '@sloppy/types';
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
	#stacks = new SvelteMap<OwnedRef, BlockView[]>();
	#busy = $state(false);
	#says = $state<string | null>(null);
	#hasFollowing = $state(false);
	#hasRegions = $state(false);
	/** Nothing held belongs to whoever signs in next. */
	#reader: string | null = null;
	/** The listing being walked, and whose it is: an identity publishes a region
	 *  once, so a page repeating one is refused rather than shown twice. */
	#listing: { of: string; reading: PublishedIndexReader } | null = null;

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

	/** Whether both lists are here. False leaves something to ask for again. */
	get loaded(): boolean {
		return this.#hasFollowing && this.#hasRegions;
	}

	region(ref: OwnedRef): PullView | undefined {
		return this.#regions.find((held) => held.ref === ref);
	}

	/** A held region's notes, in address order — empty until {@link enter}. */
	held(ref: OwnedRef): NodeView[] {
		return this.#held.get(ref) ?? [];
	}

	/** A held note's sections, in `ord` order — empty until {@link read}. */
	stack(note: OwnedRef): BlockView[] {
		return this.#stacks.get(note) ?? [];
	}

	/** Whether a held note's sections have been read this session. */
	hasStack(note: OwnedRef): boolean {
		return this.#stacks.has(note);
	}

	/**
	 * Who the reader follows and what they hold, read independently: a region is
	 * the reader's own copy, so it stays readable on a day their identity store
	 * is not. Idempotent; every surface may call it, and asking again retries
	 * only what is still missing.
	 */
	async load(): Promise<void> {
		this.#forReader();
		if (this.loaded) return;
		this.#busy = true;
		this.#says = null;
		const [follows, regions] = await Promise.all([this.#readFollowing(), this.#readRegions()]);
		this.#says = regions ?? follows;
		this.#busy = false;
	}

	async follow(did: string): Promise<boolean> {
		const done = await this.attempt(async () => {
			await api.follow({ did });
			this.#following = await api.following();
			this.#hasFollowing = true;
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
	 *  did not land, with {@link says} carrying why. `cursor` continues the
	 *  listing already on screen; without one, a new listing starts. */
	async publishedBy(
		did: string,
		options: { sourceUrl?: string; cursor?: string } = {}
	): Promise<PublishedIndex | null> {
		const of = `${did}\n${options.sourceUrl ?? ''}`;
		if (options.cursor === undefined || this.#listing?.of !== of) {
			this.#listing = { of, reading: publishedIndexReader({ did }) };
		}
		const reading = this.#listing.reading;
		const page = await this.attempt(
			() => api.publishedBy(did, options),
			'Sloppy could not read what they publish. Try again in a moment.'
		);
		if (page === null) return null;
		try {
			return reading.take(page);
		} catch {
			this.#says = 'Sloppy could not read what they publish.';
			return null;
		}
	}

	/** Take a region, or refresh the one already held at that address. */
	pull(ask: PullAsk): Promise<PullView | null> {
		return this.attempt(async () => {
			const held = await api.pullSubtree(ask.did, ask.rootAddress, ask.sourceUrl);
			this.#regions = await api.listPulls();
			this.#hasRegions = true;
			this.#forget(held.ref);
			return held;
		}, 'Sloppy could not read that branch. Try again in a moment.');
	}

	async drop(ref: OwnedRef): Promise<boolean> {
		const done = await this.attempt(async () => {
			await api.dropPull(ref);
			this.#regions = this.#regions.filter((held) => held.ref !== ref);
			this.#forget(ref);
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

	/** A held note's sections, read once and held for the session. `null` where
	 *  the ask did not land, with {@link says} carrying why. */
	async read(note: OwnedRef): Promise<BlockView[] | null> {
		if (this.#stacks.has(note)) return this.stack(note);
		const stack = await this.attempt(
			() => api.listPulledBlocks(note),
			'Sloppy could not read that note. Try again in a moment.'
		);
		if (stack) this.#stacks.set(note, stack);
		return stack;
	}

	/** After a sign-out or an erase: nothing held belongs to the next person. */
	clear(): void {
		this.#reader = null;
		this.#following = [];
		this.#regions = [];
		this.#held.clear();
		this.#stacks.clear();
		this.#says = null;
		this.#hasFollowing = false;
		this.#hasRegions = false;
		this.#listing = null;
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

	/** Null where the list arrived, or what to tell the reader where it did not. */
	async #readFollowing(): Promise<string | null> {
		if (this.#hasFollowing) return null;
		try {
			this.#following = await api.following();
			this.#hasFollowing = true;
			return null;
		} catch (error) {
			return serverMessage(error) ?? 'Sloppy could not read who you follow. Try again in a moment.';
		}
	}

	async #readRegions(): Promise<string | null> {
		if (this.#hasRegions) return null;
		try {
			this.#regions = await api.listPulls();
			this.#hasRegions = true;
			return null;
		} catch (error) {
			return (
				serverMessage(error) ?? 'Sloppy could not read what you are holding. Try again in a moment.'
			);
		}
	}

	/** A region whose copy has changed, and the notes read out of it. */
	#forget(ref: OwnedRef): void {
		for (const note of this.held(ref)) this.#stacks.delete(note.ref);
		this.#held.delete(ref);
	}

	#forReader(): void {
		const reader = session.viewer?.did ?? null;
		if (reader === this.#reader) return;
		this.clear();
		this.#reader = reader;
	}
}

export const peers = new PeersStore();
