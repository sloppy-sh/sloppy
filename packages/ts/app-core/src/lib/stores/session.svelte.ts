/**
 * Who is signed in. One writer — this store — over the API's `me` / `signOut`.
 *
 * `viewer === null` after {@link SessionStore.load} is the ordinary first visit,
 * not a failure; `ready` separates "nobody" from "not asked yet", and
 * `unavailable` separates it from "could not be asked".
 */

import { SloppyApiError, uploadFile } from '@sloppy/client';
import { splitOwnedRef, type Viewer } from '@sloppy/types';
import { api } from '../api.js';
import { deviceStore } from '../device-store.js';
import { runtime } from '../runtime.js';
import { serverMessage } from './errors.js';

/** A credential the server turned down is an answer — nobody is signed in.
 *  Anything else that goes wrong is not an answer at all. */
function turnedDown(err: unknown): boolean {
	return err instanceof SloppyApiError && err.status === 401;
}

/** What a sign-in settled and no graph here has taken yet. */
let carrying: { name?: string; picture?: { bytes: Uint8Array; type: string } } | undefined;

class SessionStore {
	#viewer = $state<Viewer | null>(null);
	#ready = $state(false);
	#loading = $state(false);
	#unavailable = $state(false);
	#inflight: Promise<Viewer | null> | null = null;
	#signInProblem = $state<string | null>(null);
	// A session change that lands while `me()` is in flight must not be undone by
	// its answer, which the server may have sent before the change reached it.
	#epoch = 0;

	get viewer(): Viewer | null {
		return this.#viewer;
	}

	get signedIn(): boolean {
		return this.#viewer !== null;
	}

	/** The graph is a folder on this device. Which deployment is running, not
	 *  whether anybody is signed in — {@link signedIn} answers that separately. */
	get onDevice(): boolean {
		return runtime.mode() === 'local';
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

	/** What went wrong finishing a sign-in this device began, for whichever
	 *  surface offers to start another. Null is nothing to say. */
	get signInProblem(): string | null {
		return this.#signInProblem;
	}

	clearSignInProblem(): void {
		this.#signInProblem = null;
	}

	/**
	 * Finish a sign-in this device began at somebody's identity store, from what
	 * the return leg carried. False is a launch that is not a return from one,
	 * so a shell may ask it of every launch — and is what one that went wrong
	 * answers too, with {@link signInProblem} saying what to do next.
	 */
	async finishSignInHere(came: URLSearchParams): Promise<boolean> {
		const identities = runtime.identities();
		if (!identities) return false;
		this.#signInProblem = null;
		let settled: Awaited<ReturnType<typeof identities.finish>>;
		try {
			settled = await identities.finish(came);
		} catch (error) {
			this.#signInProblem =
				serverMessage(error) ?? 'Sign-in did not finish. Start again from Sloppy.';
			return false;
		}
		if (!settled) return false;
		carrying = {
			...(settled.name === undefined ? {} : { name: settled.name }),
			...(settled.picture === undefined ? {} : { picture: settled.picture })
		};
		await this.refresh();
		await this.carryProfile();
		return true;
	}

	/**
	 * Write what a person's identity store calls them into the graph in front of
	 * them, where that graph is one they own. A folder somebody else owns says
	 * who THEY are and is left alone; a device with nowhere of its own to write
	 * it keeps it to carry once there is somewhere, which is what the first run
	 * calls this again for.
	 */
	async carryProfile(): Promise<void> {
		if (!carrying) return;
		const vault = runtime.vault();
		if (!vault?.folder()) return;
		const mine = this.#viewer?.did ?? (await api.me().catch(() => null))?.did;
		if (!mine) return;
		const { name, picture } = carrying;
		try {
			const here = await vault.graph();
			if (!here || splitOwnedRef(here).did !== mine) return;
			const asked = {
				...(name === undefined ? {} : { display_name: name }),
				...(picture === undefined
					? {}
					: {
							avatar_upload_id: (
								await uploadFile(
									api,
									new File([picture.bytes.slice().buffer as ArrayBuffer], 'picture', {
										type: picture.type
									}),
									{ role: 'avatar' }
								).asset
							).upload_id
						})
			};
			if (Object.keys(asked).length > 0) await api.updateProfile(asked);
			carrying = undefined;
		} catch {
			// No graph here to write it into yet.
		}
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
		const leaving = this.#viewer?.did;
		try {
			await api.signOut();
		} finally {
			this.clear();
			// Signing out is done the moment it is asked for; a device that cannot
			// answer about its own store does not hold somebody in a session.
			if (leaving) void deviceStore.forget(leaving).catch(() => {});
		}
	}

	/** Drop the session locally: nobody is signed in here any more. What this
	 *  device kept for them stays, because a session that lapsed is not a
	 *  sign-out — DESIGN.md § "Persistence". */
	clear(): void {
		this.#epoch++;
		runtime.token.clear();
		this.#viewer = null;
		this.#unavailable = false;
		this.#ready = true;
		this.#loading = false;
		this.#inflight = null;
	}
}

export const session = new SessionStore();
