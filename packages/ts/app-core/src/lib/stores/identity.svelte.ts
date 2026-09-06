/**
 * Where the signed-in person's identity is kept, and what their own store can
 * do with it. A `delegated` identity is held by a store that answers for it in
 * public; a `local` one is held by the provider this instance runs itself.
 * Whether a conversation can be held is asked of that store rather than derived
 * from where it stands — docs/ARCHITECTURE.md § "Federating the graph".
 */

import type { Converses } from '@sloppy/types';
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
	#origin = $state<string | undefined>(undefined);
	/** What the signed-in person's own store can hold, `undefined` until asked. */
	#converses = $state<Converses | undefined>(undefined);
	/** Whose answer {@link IdentityStore.#converses} is: two people signed in one
	 *  after the other keep their identities in different stores. */
	#answeredFor: string | null = null;
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

	/** Where a peer reaches the graph kept here. `undefined` until the ask has
	 *  landed, and where the instance named no origin. */
	get servedAt(): string | undefined {
		return this.#origin;
	}

	/**
	 * Whether this person's own store can hold a conversation: both halves of
	 * one, because a store that takes a comment and publishes no listing of one
	 * gives the writer a comment that is gone on the next read. `undefined`
	 * until the ask lands, and a surface offers nothing meanwhile.
	 */
	get converses(): boolean | undefined {
		const viewer = session.viewer;
		if (!viewer || this.#answeredFor !== viewer.did || this.#converses === undefined) {
			return undefined;
		}
		return this.#converses.comments && this.#converses.reactions;
	}

	/** Deduped: every surface may call it on mount. An ask that did not land is
	 *  not remembered as an answer, so the next mount asks again. */
	load(): Promise<void> {
		if (this.#inflight) return this.#inflight;
		const viewer = session.viewer;
		const askHere = this.#here === undefined;
		const askConverses = viewer !== null && this.#answeredFor !== viewer.did;
		if (!askHere && !askConverses) return Promise.resolve();
		const epoch = this.#epoch;
		const current = () => epoch === this.#epoch;
		const request = Promise.all([
			askHere
				? api
						.instanceHome()
						.then((home) => {
							if (!current()) return;
							this.#here = home.instance_url;
							this.#origin = home.instance_origin;
						})
						.catch(() => {})
				: Promise.resolve(),
			askConverses
				? api
						.converses()
						.then((answer) => {
							if (!current() || session.viewer?.did !== viewer.did) return;
							this.#converses = answer;
							this.#answeredFor = viewer.did;
						})
						.catch(() => {})
				: Promise.resolve()
		])
			.then(() => {})
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
		this.#converses = undefined;
		this.#answeredFor = null;
		this.#inflight = null;
	}
}

export const identity = new IdentityStore();
