/**
 * Who is signed in. One writer — this store — over the API's `me` / `signOut`.
 *
 * `viewer === null` after {@link SessionStore.load} is the ordinary first visit,
 * not a failure; `ready` is what separates "nobody" from "not asked yet".
 */

import type { Viewer } from '@sloppy/types';
import { api } from '../api.js';
import { runtime } from '../runtime.js';

class SessionStore {
	#viewer = $state<Viewer | null>(null);
	#ready = $state(false);
	#loading = $state(false);
	#inflight: Promise<Viewer | null> | null = null;
	// A sign-out or a sign-in that lands while `me()` is in flight must not be
	// undone by its answer, which the server may have sent before either reached
	// it.
	#epoch = 0;

	get viewer(): Viewer | null {
		return this.#viewer;
	}

	get signedIn(): boolean {
		return this.#viewer !== null;
	}

	/** True once the first {@link load} has settled, either way. */
	get ready(): boolean {
		return this.#ready;
	}

	get loading(): boolean {
		return this.#loading;
	}

	/** Idempotent and deduped: every surface may call it on mount. */
	load(): Promise<Viewer | null> {
		if (this.#ready && !this.#inflight) return Promise.resolve(this.#viewer);
		return this.refresh();
	}

	/** Ask again even if the answer is already known — after a consent
	 *  round-trip, or when a shell suspects the session moved on. */
	refresh(): Promise<Viewer | null> {
		if (this.#inflight) return this.#inflight;
		const epoch = this.#epoch;
		const current = () => epoch === this.#epoch;
		this.#loading = true;
		const request = api
			.me()
			.then((viewer) => {
				if (current()) this.#viewer = viewer;
				return viewer;
			})
			.catch(() => {
				// A rejected or unreachable session is nobody signed in; the shell's
				// `onAuthInvalid` is what turns a rejected credential into a sign-out.
				if (current()) this.#viewer = null;
				return null;
			})
			.finally(() => {
				if (!current()) return;
				this.#ready = true;
				this.#loading = false;
				this.#inflight = null;
			});
		this.#inflight = request;
		return request;
	}

	/** After a shell exchanges a consent callback for a session itself. */
	adopt(viewer: Viewer, token: string): void {
		this.#epoch++;
		runtime.token.set(token);
		this.#viewer = viewer;
		this.#ready = true;
		this.#loading = false;
		this.#inflight = null;
	}

	async signOut(): Promise<void> {
		try {
			await api.signOut();
		} finally {
			this.clear();
		}
	}

	/** Drop the session locally. The shell calls this from `onAuthInvalid`. */
	clear(): void {
		this.#epoch++;
		runtime.token.clear();
		this.#viewer = null;
		this.#ready = true;
		this.#loading = false;
		this.#inflight = null;
	}
}

export const session = new SessionStore();
