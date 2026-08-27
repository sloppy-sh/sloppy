// The custom emoji an identity publishes, one catalog per DID — so a note
// written with somebody else's shortcode resolves against THEIR catalog rather
// than the reader's. Ported from slyng's `stores/emojis.svelte.ts`, with the
// fetch it hard-coded handed in instead: this package reaches no API.

import { SvelteMap } from 'svelte/reactivity';
import type { CustomEmojiEntry } from './catalog.js';

export type LoadCatalog = (did: string) => Promise<readonly CustomEmojiEntry[]>;

const EMPTY: readonly CustomEmojiEntry[] = [];

class EmojiCatalogs {
	#held = new SvelteMap<string, readonly CustomEmojiEntry[]>();
	#loading = new Set<string>();

	/**
	 * Safe to read while rendering: one nothing has fetched answers empty and
	 * starts loading, and whatever read it runs again when the catalog lands.
	 * A read that failed is not an answer, so it is not kept — an instance
	 * having a bad minute must not blank somebody's emoji for the tab's life.
	 */
	of(did: string | undefined, load: LoadCatalog | undefined): readonly CustomEmojiEntry[] {
		if (!did) return EMPTY;
		const held = this.#held.get(did);
		if (held) return held;
		if (load && !this.#loading.has(did)) {
			this.#loading.add(did);
			void load(did)
				.then((entries) => this.#held.set(did, entries))
				.catch(() => undefined)
				.finally(() => this.#loading.delete(did));
		}
		return EMPTY;
	}

	/** Call where the catalog itself changed, so the next read fetches it again. */
	forget(did: string): void {
		this.#held.delete(did);
		this.#loading.delete(did);
	}
}

export const emojiCatalogs = new EmojiCatalogs();
