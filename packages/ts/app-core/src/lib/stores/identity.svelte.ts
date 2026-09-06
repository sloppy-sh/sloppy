/**
 * Where the signed-in person's identity is kept, and therefore what it can do.
 * A `delegated` identity is held by a store that answers for it in public; a
 * `local` one is held by the provider this instance runs itself, which answers
 * for nobody — so it has no conversation at all, and a surface that offers one
 * is offering a control that refuses every time.
 * docs/ARCHITECTURE.md § "Federating the graph".
 */

import { api } from '../api.js';
import { session } from './session.svelte.js';

export type IdentityKind = 'local' | 'delegated';

/** Two spellings of one instance are one instance, so the comparison is made
 *  on the origin rather than on what either side happened to write. */
function sameInstance(a: string, b: string): boolean {
	try {
		return new URL(a).origin === new URL(b).origin;
	} catch {
		return false;
	}
}

class IdentityStore {
	/** Where this instance's own identities live: `null` where it keeps none,
	 *  `undefined` until it has been asked. */
	#here = $state<string | null | undefined>(undefined);
	/** Where a peer reaches the graph this instance serves. */
	#origin = $state<string | undefined>(undefined);
	#inflight: Promise<void> | null = null;
	// A sign-out that lands mid-request must not be undone by its answer.
	#epoch = 0;

	/**
	 * `undefined` until somebody is signed in and the ask has landed. A surface
	 * waits for it rather than guessing: drawing a conversation on a guess is
	 * what puts a control that cannot work in front of somebody.
	 */
	get kind(): IdentityKind | undefined {
		const viewer = session.viewer;
		if (!viewer || this.#here === undefined) return undefined;
		return this.#here !== null && sameInstance(viewer.syr_instance_url, this.#here)
			? 'local'
			: 'delegated';
	}

	/**
	 * Where somebody else reaches the graph kept here, which a reader needs
	 * beside the author's own identity. `undefined` until the ask has landed,
	 * and where the instance is reached by an address nobody could be handed.
	 */
	get servedAt(): string | undefined {
		return this.#origin;
	}

	/** Whether this person can hold a conversation at all — false while
	 *  {@link IdentityStore.kind} is unknown, so nothing is offered on a guess.
	 *  Copy that would alarm somebody waits the other way, on `kind === 'local'`. */
	get converses(): boolean {
		return this.kind === 'delegated';
	}

	/** Deduped: every surface may call it on mount. An ask that did not land is
	 *  not remembered as an answer, so the next mount asks again. */
	load(): Promise<void> {
		if (this.#inflight) return this.#inflight;
		if (this.#here !== undefined) return Promise.resolve();
		const epoch = this.#epoch;
		const current = () => epoch === this.#epoch;
		const request = api
			.instanceHome()
			.then((home) => {
				if (!current()) return;
				this.#here = home.instance_url;
				this.#origin = home.instance_origin;
			})
			.catch(() => {})
			.finally(() => {
				if (current()) this.#inflight = null;
			});
		this.#inflight = request;
		return request;
	}

	/** After a sign-out or an erase, when the shell may be reaching a different
	 *  instance by the time anybody asks again. */
	clear(): void {
		this.#epoch++;
		this.#here = undefined;
		this.#origin = undefined;
		this.#inflight = null;
	}
}

export const identity = new IdentityStore();
