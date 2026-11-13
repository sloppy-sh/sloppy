/**
 * Who somebody is, as their identity store reports them: read on demand, held
 * for the session, and never written down — AI.md § "Sloppy's Vocabulary Stays
 * Out of the Identity Store". Every surface that names a person reads this one,
 * so the nav, the settings row and a note's author cannot disagree.
 */

import { ServerRequiredError, SloppyApiError } from '@sloppy/client';
import {
	NOT_PUBLIC_SAID,
	principalScheme,
	type ProfileView,
	UNREACHED_SAID,
	type W3id
} from '@sloppy/types';
import type { Person } from '@sloppy/ui';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { api } from '../api.js';
import { pictureSrc } from '../asset-src.js';
import { runtime } from '../runtime.js';
import { faceSrc, resolveW3id, type W3idAnswer, type W3idProfile } from '../w3id.js';
import { prefs } from './prefs.svelte.js';

/** How long an answer that never came stands before somebody is asked again. */
export const UNREACHED_FOR_MS = 5 * 60_000;

/** Their pictures resolved for an `<img>`; the rest is the store's own answer.
 *  A store with nothing to call them by answers with the identity itself, which
 *  is nobody's name and is not read as one. */
export function personFrom(profile: ProfileView): Person {
	return {
		identity: profile.did,
		displayName: profile.display_name,
		handle: profile.username === profile.did ? null : profile.username,
		bio: profile.bio,
		avatar: profile.avatar_src && pictureSrc(profile.avatar_src),
		banner: profile.banner_src && pictureSrc(profile.banner_src)
	};
}

/** Somebody named by a W3ID, as their own profile says. */
export function personOfW3id(principal: W3id, profile: W3idProfile): Person {
	return {
		identity: principal,
		displayName: profile.name,
		handle: profile.handle,
		bio: profile.bio,
		avatar: profile.avatar ? faceSrc(profile.avatar) : null,
		banner: null
	};
}

interface W3idHeld {
	registry: string;
	answer: W3idAnswer;
	person: Person | null;
	at: number;
}

/** Whether no name is coming: their store answered with nobody, or there is no
 *  way from here to ask one — a graph served off this device reaches nobody's
 *  store. */
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
	#w3ids = new SvelteMap<W3id, W3idHeld>();
	#w3idsInflight = new Map<W3id, Promise<W3idAnswer>>();
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
		this.#w3ids.clear();
		this.#w3idsInflight.clear();
	}

	/** Anyone, once their instance has answered {@link resolve}. */
	of(did: string): Person | null {
		if (principalScheme(did) === 'w3id') return this.#w3ids.get(did as W3id)?.person ?? null;
		const known = did === this.#me?.did ? this.#me : this.#others.get(did);
		return known ? personFrom(known) : null;
	}

	/** Whether their instance answered with nobody, so no name is coming and a
	 *  surface can stop waiting for one. */
	unplaced(did: string): boolean {
		if (principalScheme(did) === 'w3id') {
			const answer = this.#w3ids.get(did as W3id)?.answer;
			return answer === 'not-public' || answer === 'unreached';
		}
		return this.#unplaced.has(did);
	}

	/** Why somebody shows unnamed, where it is theirs to know. A device that
	 *  cannot ask has nothing to say about them. */
	said(did: string): string | null {
		if (principalScheme(did) !== 'w3id' || !runtime.reachOut()) return null;
		const answer = this.#w3ids.get(did as W3id)?.answer;
		if (answer === 'not-public') return NOT_PUBLIC_SAID;
		if (answer === 'unreached') return UNREACHED_SAID;
		return null;
	}

	/**
	 * What somebody named by a W3ID's own profile says, asked once a session
	 * through wherever Settings → People names. An answer that never came is
	 * asked again after {@link UNREACHED_FOR_MS}. A device that cannot ask
	 * answers `unreached` without asking.
	 */
	w3id(principal: W3id): Promise<W3idAnswer> {
		const registry = prefs.current.w3idRegistry;
		const held = this.#w3ids.get(principal);
		if (held && held.registry === registry && !stale(held)) return Promise.resolve(held.answer);
		const asking = this.#w3idsInflight.get(principal);
		if (asking) return asking;
		const http = runtime.reachOut();
		const at = this.#epoch;
		const request = (
			http ? resolveW3id(principal, registry, http) : Promise.resolve<W3idAnswer>('unreached')
		)
			.then((answer) => {
				if (at === this.#epoch) {
					const person = typeof answer === 'object' ? personOfW3id(principal, answer) : null;
					this.#w3ids.set(principal, { registry, answer, person, at: Date.now() });
				}
				return answer;
			})
			.finally(() => {
				if (this.#w3idsInflight.get(principal) === request) this.#w3idsInflight.delete(principal);
			});
		this.#w3idsInflight.set(principal, request);
		return request;
	}

	/** Asks for somebody a surface is about to name. Deduped, and silent about a
	 *  refusal: an identity nobody here can resolve is a name the surface does
	 *  without, not news to break to the reader. */
	resolve(did: string): void {
		if (!did || did === this.#me?.did) return;
		if (principalScheme(did) === 'w3id') {
			void this.w3id(did as W3id);
			return;
		}
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

	/** {@link resolve}, for a caller that waits for the answer. */
	async resolved(did: string): Promise<void> {
		this.resolve(did);
		await this.#othersInflight.get(did);
	}
}

function stale(held: W3idHeld): boolean {
	return held.answer === 'unreached' && Date.now() - held.at > UNREACHED_FOR_MS;
}

export const people = new PeopleStore();
