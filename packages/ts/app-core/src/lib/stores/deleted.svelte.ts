/**
 * The branches somebody deleted and can still put back, and the one writer over
 * the route that puts one back.
 *
 * The listing is asked for whenever the surface holding it opens rather than
 * kept in step: a branch leaves it by being put back, and by running out of
 * time, and only one of those two is something this device does.
 */

import type { DeletedBranch, NodeView, OwnedRef } from '@sloppy/types';
import { api } from '../api.js';
import { serverMessage } from './errors.js';
import { session } from './session.svelte.js';

export interface DeletedState {
	loading: boolean;
	/** True once a load has succeeded; stays true while a reload is in flight. */
	loaded: boolean;
	failed: boolean;
	/** The server's own words, where it gave any. */
	error?: string;
}

const IDLE: DeletedState = { loading: false, loaded: false, failed: false };

class DeletedStore {
	#all = $state<DeletedBranch[]>([]);
	#state = $state<DeletedState>(IDLE);
	#inflight: Promise<DeletedBranch[]> | null = null;
	#whose = $state<string | null>(null);
	// A {@link clear} that lands mid-request must not be undone by the answer.
	#epoch = 0;

	/** Newest first, and empty until the person they belong to is the one here. */
	get all(): DeletedBranch[] {
		return this.#whose !== null && this.#whose === session.viewer?.did ? this.#all : [];
	}

	get state(): DeletedState {
		return this.#state;
	}

	load(): Promise<DeletedBranch[]> {
		if (this.#inflight) return this.#inflight;
		if (this.#state.loaded) return Promise.resolve(this.all);
		return this.reload();
	}

	reload(): Promise<DeletedBranch[]> {
		if (this.#inflight) return this.#inflight;
		const epoch = this.#epoch;
		const current = () => epoch === this.#epoch;
		const before = this.#state;
		const whose = session.viewer?.did ?? null;
		this.#state = { ...before, loading: true, failed: false, error: undefined };
		const request = api
			.deletedBranches()
			.then((list) => {
				if (!current()) return [];
				this.#all = list;
				this.#whose = whose;
				this.#state = { loading: false, loaded: true, failed: false };
				return list;
			})
			.catch((err: unknown) => {
				if (current()) {
					this.#state = {
						loading: false,
						loaded: before.loaded,
						failed: true,
						error: serverMessage(err)
					};
				}
				throw err;
			})
			.finally(() => {
				if (current()) this.#inflight = null;
			});
		this.#inflight = request;
		return request;
	}

	/** One branch back where it was, answering with its root. It leaves this
	 *  listing whether or not anything else in it has changed. */
	async restore(ref: OwnedRef): Promise<NodeView> {
		const epoch = this.#epoch;
		const back = await api.restoreBranch(ref);
		if (epoch === this.#epoch) {
			this.#all = this.#all.filter((branch) => branch.ref !== ref);
		}
		return back;
	}

	/** After a sign-out or an erase: nothing here belongs to the next person. */
	clear(): void {
		this.#epoch++;
		this.#all = [];
		this.#whose = null;
		this.#state = IDLE;
		this.#inflight = null;
	}
}

export const deleted = new DeletedStore();
