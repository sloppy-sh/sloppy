/**
 * What the signed-in person publishes: the branches they have made readable,
 * the chain of versions of each, and the acts that change them.
 *
 * A publication is keyed by its own ref and CARRIES the address it is rooted
 * at, so which notes one covers is answered from the address rather than
 * stored — `isInSubtree` is that answer, here and everywhere else.
 * docs/ARCHITECTURE.md § "Federating the graph".
 */

import {
	addressDepth,
	type CommentAccess,
	compareAddresses,
	isInSubtree,
	type NodeView,
	type OwnedRef,
	type PublicationView,
	type PublishedNoteChange,
	type PublishedVersion,
	splitOwnedRef
} from '@sloppy/types';
import { SvelteMap } from 'svelte/reactivity';
import { api } from '../api.js';
import { serverMessage } from './errors.js';

export interface PublicationsState {
	loading: boolean;
	/** True once a load has succeeded; stays true while a reload is in flight. */
	loaded: boolean;
	failed: boolean;
	/** The server's own words, where it gave any. */
	error?: string;
}

const IDLE: PublicationsState = { loading: false, loaded: false, failed: false };

/** How many versions of one publication a person is shown. A chain is appended
 *  to forever; the newest few are the ones anybody reads back. */
const RECENT_VERSIONS = 12;

class PublicationsStore {
	#byRef = new SvelteMap<OwnedRef, PublicationView>();
	#state = $state<PublicationsState>(IDLE);
	#inflight: Promise<PublicationView[]> | null = null;
	#versions = new SvelteMap<OwnedRef, PublishedVersion[]>();
	#versionsInflight = new Map<OwnedRef, Promise<PublishedVersion[]>>();
	// A sign-out that lands mid-request must not be undone by its answer.
	#epoch = 0;

	get state(): PublicationsState {
		return this.#state;
	}

	/** In address order, which is the order the graph reads them in. */
	get all(): PublicationView[] {
		return [...this.#byRef.values()].sort((a, b) =>
			compareAddresses(a.root_address, b.root_address)
		);
	}

	/** Deduped: every surface may call it on mount. */
	load(): Promise<PublicationView[]> {
		if (this.#inflight) return this.#inflight;
		if (this.#state.loaded) return Promise.resolve(this.all);
		return this.reload();
	}

	reload(): Promise<PublicationView[]> {
		if (this.#inflight) return this.#inflight;
		const epoch = this.#epoch;
		const current = () => epoch === this.#epoch;
		const before = this.#state;
		this.#state = { ...before, loading: true, failed: false, error: undefined };
		const request = api
			.listPublications()
			.then((held) => {
				if (!current()) return [];
				this.#byRef.clear();
				for (const publication of held) this.#byRef.set(publication.ref, publication);
				this.#state = { loading: false, loaded: true, failed: false };
				return this.all;
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

	/** The publication rooted at this exact note, which is the one an act here
	 *  changes. */
	at(note: NodeView): PublicationView | undefined {
		return this.all.find(
			(publication) =>
				this.authorOf(publication) === note.created_by && publication.root_address === note.address
		);
	}

	/** A publication rooted ABOVE this note that already carries it. Where
	 *  several do, the nearest — it is the one whose address a person recognises. */
	above(note: NodeView): PublicationView | undefined {
		return this.all
			.filter(
				(publication) =>
					this.authorOf(publication) === note.created_by &&
					publication.root_address !== note.address &&
					isInSubtree(publication.root_address, note.address)
			)
			.sort((a, b) => addressDepth(a.root_address) - addressDepth(b.root_address))
			.at(-1);
	}

	/**
	 * Publications rooted UNDER this note that invite fewer people to answer.
	 * Publishing here carries their notes on this publication's terms, so these
	 * are what a person has to be told about before they do — docs/ARCHITECTURE.md
	 * § "Federating the graph".
	 */
	narrowerUnder(note: NodeView, terms: CommentAccess): PublicationView[] {
		if (terms !== 'anyone') return [];
		return this.all.filter(
			(publication) =>
				this.authorOf(publication) === note.created_by &&
				publication.root_address !== note.address &&
				isInSubtree(note.address, publication.root_address) &&
				publication.comments !== 'anyone'
		);
	}

	/**
	 * Who the author has invited to answer this note, or `null` where nothing
	 * they publish carries it. The WIDEST invitation of the publications that
	 * cover it, because a reader holding any one of them is reading on its
	 * terms — docs/ARCHITECTURE.md § "Federating the graph".
	 */
	answersOn(note: NodeView): CommentAccess | null {
		const covering = this.all.filter(
			(publication) =>
				this.authorOf(publication) === note.created_by &&
				isInSubtree(publication.root_address, note.address)
		);
		if (covering.length === 0) return null;
		return covering.some((publication) => publication.comments === 'anyone') ? 'anyone' : 'nobody';
	}

	/** The chain, newest version first, as far back as a person is shown. */
	versions(ref: OwnedRef): PublishedVersion[] {
		return (this.#versions.get(ref) ?? []).slice(0, RECENT_VERSIONS);
	}

	/** The chain, read once. A version is appended and never edited, so one in
	 *  hand stays true until this instance publishes another. */
	loadVersions(ref: OwnedRef): Promise<PublishedVersion[]> {
		if (this.#versions.has(ref)) return Promise.resolve(this.versions(ref));
		return this.readVersions(ref);
	}

	/** Deduped against a concurrent ask for the same chain. */
	readVersions(ref: OwnedRef): Promise<PublishedVersion[]> {
		const inflight = this.#versionsInflight.get(ref);
		if (inflight) return inflight;
		const epoch = this.#epoch;
		const current = () => epoch === this.#epoch;
		const request = api
			.publicationVersions(ref)
			.then((chain) => {
				if (current()) this.#versions.set(ref, chain);
				return chain;
			})
			.finally(() => {
				if (current()) this.#versionsInflight.delete(ref);
			});
		this.#versionsInflight.set(ref, request);
		return request;
	}

	/** Publish the branch rooted at this note, as it stands. A note that already
	 *  has a publication gets another version of it. */
	async publish(root: OwnedRef): Promise<PublicationView> {
		const epoch = this.#epoch;
		const published = await api.publish({ root });
		if (epoch !== this.#epoch) return published;
		this.#byRef.set(published.ref, published);
		this.#versions.delete(published.ref);
		await this.readVersions(published.ref).catch(() => []);
		return published;
	}

	async setComments(ref: OwnedRef, comments: CommentAccess): Promise<PublicationView> {
		const epoch = this.#epoch;
		const changed = await api.updatePublication(ref, { comments });
		if (epoch === this.#epoch) this.#byRef.set(changed.ref, changed);
		return changed;
	}

	async unpublish(ref: OwnedRef): Promise<void> {
		const epoch = this.#epoch;
		await api.unpublish(ref);
		if (epoch !== this.#epoch) return;
		this.#byRef.delete(ref);
		this.#versions.delete(ref);
	}

	/**
	 * What the writing did between two versions, in address order. The
	 * comparison is made where the versions are, so this is a read and not a
	 * download of both sides.
	 */
	async changes(ref: OwnedRef, from: OwnedRef, to: OwnedRef): Promise<PublishedNoteChange[]> {
		const page = await api.publishedChanges(ref, from, to);
		return page.changes;
	}

	/** After a sign-out or an erase: nothing here belongs to the next person. */
	clear(): void {
		this.#epoch++;
		this.#byRef.clear();
		this.#versions.clear();
		this.#versionsInflight.clear();
		this.#inflight = null;
		this.#state = IDLE;
	}

	private authorOf(publication: PublicationView): string {
		return splitOwnedRef(publication.ref).did;
	}
}

export const publications = new PublicationsStore();
