/**
 * Who somebody is, as their identity store reports them: read on demand, held
 * for the session, and never written down — AI.md § "Sloppy's Vocabulary Stays
 * Out of the Identity Store". Every surface that names a person reads this one,
 * so the nav, the settings row and a note's author cannot disagree.
 */

import { ServerRequiredError, SloppyApiError } from '@sloppy/client';
import type { ProfileView } from '@sloppy/types';
import { unplacedPerson, type Person } from '@sloppy/ui';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { api } from '../api.js';
import { pictureSrc } from '../asset-src.js';

/** Their pictures resolved for an `<img>`; the rest is the store's own answer.
 *  Somebody with nothing to be known by but the identity itself reads the way
 *  everyone unnamed does, rather than carrying it at full length. */
export function personFrom(profile: ProfileView): Person {
	return {
		displayName: profile.display_name,
		handle:
			profile.username === profile.did ? unplacedPerson(profile.did).handle : profile.username,
		bio: profile.bio,
		avatar: profile.avatar_src && pictureSrc(profile.avatar_src),
		banner: profile.banner_src && pictureSrc(profile.banner_src)
	};
}

/** Whether no name is coming: their store answered with nobody, or there is no
 *  way from here to ask one — a graph served off this device reaches nobody's
 *  store, and the identity itself is what a surface draws them as. */
function noNameIsComing(error: unknown): boolean {
	return (
		error instanceof ServerRequiredError ||
		(error instanceof SloppyApiError && error.status === 404)
	);
}

class PeopleStore {
	#me = $state<ProfileView | null>(null);
	#asking: Promise<ProfileView> | null = null;
	#others = new SvelteMap<string, ProfileView>();
	#othersInflight = new Map<string, Promise<void>>();
	#unplaced = new SvelteSet<string>();
	// A sign-out that lands while a read is in flight must not be undone by its
	// answer, which belongs to whoever just left.
	#epoch = 0;

	/** The signed-in person, for a surface that will not wait for a read. */
	get me(): ProfileView | null {
		return this.#me;
	}

	/** Deduped: every surface may call it on mount. */
	read(): Promise<ProfileView> {
		if (this.#me) return Promise.resolve(this.#me);
		if (this.#asking) return this.#asking;
		const at = this.#epoch;
		const request: Promise<ProfileView> = api
			.profile()
			.then((profile) => {
				if (at === this.#epoch) this.#me = profile;
				return profile;
			})
			.finally(() => {
				if (this.#asking === request) this.#asking = null;
			});
		this.#asking = request;
		return request;
	}

	/** The store's answer after a change, or `null` when the person signs out. */
	hold(profile: ProfileView | null): void {
		this.#epoch += 1;
		this.#asking = null;
		this.#me = profile;
		this.#others.clear();
		this.#othersInflight.clear();
		this.#unplaced.clear();
	}

	/** Anyone, once their instance has answered {@link resolve}. */
	of(did: string): Person | null {
		const known = did === this.#me?.did ? this.#me : this.#others.get(did);
		return known ? personFrom(known) : null;
	}

	/** Whether their instance answered with nobody. A surface draws them as the
	 *  identifier they travel by, settled: no name is coming. */
	unplaced(did: string): boolean {
		return this.#unplaced.has(did);
	}

	/** Asks for somebody a surface is about to name. Deduped, and silent about a
	 *  refusal: an identity nobody here can resolve is a name the surface does
	 *  without, not news to break to the reader. */
	resolve(did: string): void {
		if (!did || did === this.#me?.did) return;
		if (this.#others.has(did) || this.#othersInflight.has(did)) return;
		if (this.#unplaced.has(did)) return;
		const at = this.#epoch;
		const request = api
			.profileOf(did)
			.then((profile) => {
				if (at === this.#epoch) this.#others.set(did, profile);
			})
			.catch((error: unknown) => {
				if (at === this.#epoch && noNameIsComing(error)) this.#unplaced.add(did);
			})
			.finally(() => {
				this.#othersInflight.delete(did);
			});
		this.#othersInflight.set(did, request);
	}
}

export const people = new PeopleStore();
