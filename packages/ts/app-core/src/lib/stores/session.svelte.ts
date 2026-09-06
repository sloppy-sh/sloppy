/**
 * Who is signed in. One writer — this store — over the API's `me` / `signOut`.
 *
 * `viewer === null` after {@link SessionStore.load} is the ordinary first visit,
 * not a failure; `ready` separates "nobody" from "not asked yet", and
 * `unavailable` separates it from "could not be asked".
 */

import { SloppyApiError } from '@sloppy/client';
import type { Viewer } from '@sloppy/types';
import { api } from '../api.js';
import { deviceStore } from '../device-store.js';
import { runtime } from '../runtime.js';

/** A credential the server turned down is an answer — nobody is signed in.
 *  Anything else that goes wrong is not an answer at all. */
function turnedDown(err: unknown): boolean {
	return err instanceof SloppyApiError && err.status === 401;
}

class SessionStore {
	#viewer = $state<Viewer | null>(null);
	#ready = $state(false);
	#loading = $state(false);
	#unavailable = $state(false);
	#inflight: Promise<Viewer | null> | null = null;
	// A session change that lands while `me()` is in flight must not be undone by
	// its answer, which the server may have sent before the change reached it.
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

	/** The last ask failed, so `viewer === null` means Sloppy could not say who
	 *  is signed in — not that nobody is. */
	get unavailable(): boolean {
		return this.#unavailable;
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
				if (current()) {
					this.#viewer = viewer;
					this.#unavailable = false;
				}
				return viewer;
			})
			.catch((err: unknown) => {
				if (current()) {
					this.#viewer = null;
					this.#unavailable = !turnedDown(err);
				}
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
		this.#unavailable = false;
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

	/** Drop the session locally, and everything this device kept for whoever was
	 *  signed in. The shell calls this from `onAuthInvalid`. */
	clear(): void {
		const leaving = this.#viewer?.did;
		this.#epoch++;
		runtime.token.clear();
		this.#viewer = null;
		this.#unavailable = false;
		this.#ready = true;
		this.#loading = false;
		this.#inflight = null;
		// Signing out is done the moment it is asked for; a device that cannot
		// answer about its own store does not hold somebody in a session.
		if (leaving) void deviceStore.forget(leaving).catch(() => {});
	}
}

export const session = new SessionStore();
