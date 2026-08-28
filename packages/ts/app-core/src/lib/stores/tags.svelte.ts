/**
 * The tag axis: every tag the reader has used, and which of them the graph is
 * lit by. One reader over the API's tag route.
 *
 * There is no tag row to cache — a tag exists exactly as long as a note carries
 * one — so this holds a count that goes stale the moment a note is retagged,
 * and {@link reload} is how a surface asks again.
 *
 * The selection is persisted, so it lives in the prefs store; this store is
 * where it is read and changed, because the rail and the canvas both need it
 * beside the counts.
 */

import type { Tag, TagCount } from '@sloppy/types';
import { api } from '../api.js';
import { serverMessage } from './errors.js';
import { prefs } from './prefs.svelte.js';

class TagsStore {
	#all = $state<TagCount[]>([]);
	#loading = $state(false);
	#loaded = $state(false);
	#failed = $state(false);
	#error = $state<string | undefined>(undefined);
	#inflight: Promise<TagCount[]> | null = null;
	// A {@link clear} that lands mid-request must not be undone by the answer:
	// nothing the previous person's graph returns belongs to the next one.
	#epoch = 0;

	/** Most-used first, which is the order the read answers in. */
	get all(): TagCount[] {
		return this.#all;
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

	/** In selection order — DESIGN.md § Hue reads the slots off that order. */
	get selected(): Tag[] {
		return prefs.current.tags;
	}

	select(tags: Tag[]): void {
		prefs.set('tags', tags);
	}

	/** Deduped and idempotent: every surface may call it on mount. */
	load(): Promise<TagCount[]> {
		if (this.#inflight) return this.#inflight;
		if (this.#loaded) return Promise.resolve(this.#all);
		return this.reload();
	}

	reload(): Promise<TagCount[]> {
		if (this.#inflight) return this.#inflight;
		const epoch = this.#epoch;
		const current = () => epoch === this.#epoch;
		this.#loading = true;
		this.#failed = false;
		this.#error = undefined;
		const request = api
			.listTags()
			.then((list) => {
				if (!current()) return [];
				this.#all = list;
				this.#loaded = true;
				return list;
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

	/** After a sign-out or an erase: nothing cached belongs to the next person. */
	clear(): void {
		this.#epoch++;
		this.#all = [];
		this.#loaded = false;
		this.#loading = false;
		this.#failed = false;
		this.#error = undefined;
		this.#inflight = null;
		this.select([]);
	}
}

export const tags = new TagsStore();
