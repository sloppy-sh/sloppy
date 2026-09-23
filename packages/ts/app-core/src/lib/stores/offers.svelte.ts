/**
 * The changes offered on a note its owner gates: the ones standing on it, the
 * one this device is composing, and the acts that settle one — AI.md § "The
 * Genealogy Is the Protocol", docs/ARCHITECTURE.md § "Whose writing a note
 * carries".
 *
 * `writeOutcome` in `@sloppy/types` is the rule about whether a write lands at
 * all; every surface reads that one and this store carries what happens when it
 * does not.
 */

import {
	BlockDocumentSchema,
	BlockViewSchema,
	EdgeLookSchema,
	emptyDocument,
	looksWritten,
	splitOwnedRef,
	TagsSchema,
	ulid,
	type AmendmentView,
	type BlockView,
	type CreateBlockRequest,
	type EdgeLook,
	type NodeView,
	type OwnedRef,
	type ProposeAmendmentRequest,
	type Tag,
	type UpdateBlockRequest
} from '@sloppy/types';
import { SvelteMap } from 'svelte/reactivity';
import { api } from '../api.js';
import { deviceStore, type DeviceArea } from '../device-store.js';
import { serverMessage } from './errors.js';
import { nodes } from './nodes.svelte.js';
import { session } from './session.svelte.js';

const AREA = 'offers';

/** A note's writing as somebody would have it. The sections stand in the order
 *  they read; nothing about the note's place is here, because an offer does not
 *  carry one. */
export interface OfferDraft {
	title: string;
	tags: Tag[];
	/** The looks on the note's lines, whole. Absent leaves the note's own looks
	 *  alone, which is what an offer saying nothing about them says. */
	edges?: EdgeLook[];
	blocks: BlockView[];
}

/** Sections stand in the order of the array they are in, so the index is the
 *  whole of what an `ord` says here and none of it ever leaves the device. */
function ordered(blocks: readonly BlockView[]): BlockView[] {
	return blocks.map((block, at) => ({ ...block, ord: String(at).padStart(4, '0') }));
}

/** Where a section following `after` goes, by the rule `CreateBlockRequest`
 *  states: `null` puts it at the top, and so does a neighbour this stack does
 *  not hold. */
function placeIn(blocks: readonly BlockView[], after: OwnedRef | null): number {
	return after === null ? 0 : blocks.findIndex((one) => one.ref === after) + 1;
}

function sameLooks(
	a: readonly EdgeLook[] | undefined,
	b: readonly EdgeLook[] | undefined
): boolean {
	if (a === undefined || b === undefined) return a === b;
	return (
		a.length === b.length &&
		a.every(
			(look, at) =>
				look.to === b[at].to &&
				look.label === b[at].label &&
				look.direction === b[at].direction &&
				look.stroke === b[at].stroke
		)
	);
}

function sameWriting(a: OfferDraft, b: OfferDraft): boolean {
	return (
		a.title === b.title &&
		sameLooks(a.edges, b.edges) &&
		a.tags.length === b.tags.length &&
		a.tags.every((tag, at) => tag === b.tags[at]) &&
		a.blocks.length === b.blocks.length &&
		a.blocks.every(
			(block, at) =>
				block.ref === b.blocks[at].ref &&
				JSON.stringify(block.content) === JSON.stringify(b.blocks[at].content)
		)
	);
}

/** The offer's sections as a stack a writing surface can hold. A section of an
 *  offer is named by the ref of the note section it stands for, so one the note
 *  no longer has still reads. */
function stackOf(offer: AmendmentView, note: OwnedRef): BlockView[] {
	return ordered(
		offer.blocks.map((section) => ({
			ref: section.ref,
			created_by: splitOwnedRef(note).owner,
			node: note,
			ord: '',
			content: section.content,
			created_at: offer.at,
			updated_at: offer.at
		}))
	);
}

/** What this device kept for a note, or nothing where it kept none and nothing
 *  where what it kept is no longer writing this build can read. */
function draftFrom(held: unknown): OfferDraft | null {
	if (typeof held !== 'object' || held === null) return null;
	const { title, tags, edges, blocks } = held as Record<string, unknown>;
	const named = TagsSchema.safeParse(tags);
	if (typeof title !== 'string' || !named.success || !Array.isArray(blocks)) return null;
	const lines = edges === undefined ? undefined : EdgeLookSchema.array().safeParse(edges);
	if (lines && !lines.success) return null;
	const stack: BlockView[] = [];
	for (const row of blocks) {
		const block = BlockViewSchema.safeParse(row);
		if (!block.success) return null;
		stack.push(block.data);
	}
	return {
		title,
		tags: named.data,
		...(lines === undefined ? {} : { edges: lines.data }),
		blocks: stack
	};
}

class OffersStore {
	#standing = new SvelteMap<OwnedRef, AmendmentView[]>();
	#asked = new SvelteMap<OwnedRef, 'reading' | 'settled'>();
	#drafts = new SvelteMap<OwnedRef, { draft: OfferDraft; as: OfferDraft }>();
	/** Notes whose draft is on its way up off the device, so two paints of one
	 *  note do not each open one. */
	#opening = new Set<OwnedRef>();
	#busy = $state(false);
	#says = $state<string | null>(null);
	// A sign-out that lands mid-read must not be undone by the answer: nothing
	// offered to the person who just left belongs to the next one.
	#epoch = 0;

	/** Why the last act did not happen, in the words it came back with. */
	get says(): string | null {
		return this.#says;
	}

	/** Null with nobody signed in: a change being composed is one person's, and
	 *  there is no identity to keep it under. */
	#area(): DeviceArea | null {
		const did = session.viewer?.did;
		return did ? deviceStore.area(did, AREA) : null;
	}

	get busy(): boolean {
		return this.#busy;
	}

	/** What is offered on a note, oldest first. Empty until it has been read. */
	on(note: OwnedRef): readonly AmendmentView[] {
		return this.#standing.get(note) ?? [];
	}

	/** The offer the person at this device has standing on a note. */
	mine(note: OwnedRef): AmendmentView | undefined {
		const did = session.viewer?.did;
		return did === undefined ? undefined : this.on(note).find((one) => one.by === did);
	}

	/** Whether what is offered on this note is known one way or the other, which
	 *  is what a draft waits for before it seeds itself. */
	settled(note: OwnedRef): boolean {
		return this.#asked.get(note) === 'settled';
	}

	/**
	 * What is offered on a note. Silent about a refusal: a graph that takes no
	 * offers, and a note whose offers are not this reader's to see, are both an
	 * answer of none rather than news to break to them.
	 */
	read(note: OwnedRef): Promise<void> {
		if (this.#asked.has(note)) return Promise.resolve();
		this.#asked.set(note, 'reading');
		const at = this.#epoch;
		return api
			.listAmendments(note)
			.then((offers) => {
				if (at !== this.#epoch) return;
				this.#standing.set(note, offers);
			})
			.catch(() => {})
			.finally(() => {
				if (at === this.#epoch) this.#asked.set(note, 'settled');
			});
	}

	async reread(note: OwnedRef): Promise<void> {
		this.#asked.delete(note);
		await this.read(note);
	}

	draft(note: OwnedRef): OfferDraft | undefined {
		return this.#drafts.get(note)?.draft;
	}

	/** Whether the draft says anything it did not open saying, which is the whole
	 *  of what there is to offer. */
	changed(note: OwnedRef): boolean {
		const held = this.#drafts.get(note);
		return held !== undefined && !sameWriting(held.draft, held.as);
	}

	/**
	 * Open the writing surface on this note: on what this device is still
	 * holding for it, on the offer the person already has standing there, or on
	 * the note as it stands. Does nothing where one is already open, so a note
	 * walked away from and come back to still holds what was typed into it.
	 */
	async hold(
		note: OwnedRef,
		writing: { title: string; tags: readonly Tag[]; blocks: readonly BlockView[] }
	): Promise<void> {
		if (this.#drafts.has(note) || this.#opening.has(note)) return;
		this.#opening.add(note);
		const at = this.#epoch;
		const standing = this.mine(note);
		// A draft opened on the note itself says nothing about its looks; one
		// opened on an offer already standing here carries that offer's, so
		// offering again does not take back what this person already set.
		const as: OfferDraft = standing
			? {
					title: standing.title,
					tags: [...standing.tags],
					...(standing.edges === undefined ? {} : { edges: [...standing.edges] }),
					blocks: stackOf(standing, note)
				}
			: { title: writing.title, tags: [...writing.tags], blocks: ordered(writing.blocks) };
		const kept = draftFrom(
			await this.#area()
				?.get<unknown>(note)
				.catch(() => undefined)
		);
		this.#opening.delete(note);
		if (at !== this.#epoch || this.#drafts.has(note)) return;
		this.#drafts.set(note, {
			draft: kept ?? {
				...as,
				tags: [...as.tags],
				...(as.edges === undefined ? {} : { edges: [...as.edges] }),
				blocks: [...as.blocks]
			},
			as
		});
	}

	#write(note: OwnedRef, change: (draft: OfferDraft) => OfferDraft): void {
		const held = this.#drafts.get(note);
		if (!held) return;
		const draft = change(held.draft);
		this.#drafts.set(note, { ...held, draft });
		void this.#area()
			?.set(note, $state.snapshot(draft))
			.catch(() => undefined);
	}

	/** The writing has either reached Sloppy or been taken back, so the device
	 *  stops holding it. */
	#letGo(note: OwnedRef): void {
		this.#drafts.delete(note);
		void this.#area()
			?.delete(note)
			.catch(() => undefined);
	}

	retitle(note: OwnedRef, title: string): void {
		this.#write(note, (draft) => ({ ...draft, title }));
	}

	retag(note: OwnedRef, tags: readonly Tag[]): void {
		this.#write(note, (draft) => ({ ...draft, tags: [...tags] }));
	}

	/**
	 * The look this change offers on the note's line to `look.to`, leaving the
	 * looks on its other lines as the change already had them — the note's own
	 * where it says nothing about them yet. A look with nothing said on it is
	 * what offers to take one off.
	 */
	setLook(note: OwnedRef, look: EdgeLook): void {
		this.#write(note, (draft) => {
			const now = draft.edges ?? nodes.get(note)?.edges ?? [];
			const rest = now.filter((one) => one.to !== look.to);
			return { ...draft, edges: looksWritten([...rest, look]) ?? [] };
		});
	}

	/** A section the offer adds. Its ulid is minted here and its owner half is
	 *  the note's, because the section it stands for would live in the note's
	 *  own graph. */
	addSection(request: CreateBlockRequest): BlockView {
		const note = request.node as OwnedRef;
		const written: BlockView = {
			ref: `${splitOwnedRef(note).owner}/${ulid()}`,
			created_by: splitOwnedRef(note).owner,
			node: note,
			ord: '',
			content:
				request.content === undefined
					? emptyDocument()
					: BlockDocumentSchema.parse(request.content),
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString()
		};
		this.#write(note, (draft) => {
			const at = placeIn(draft.blocks, request.after ?? null);
			return {
				...draft,
				blocks: ordered([...draft.blocks.slice(0, at), written, ...draft.blocks.slice(at)])
			};
		});
		return this.draft(note)?.blocks.find((one) => one.ref === written.ref) ?? written;
	}

	/** A section of the offer written in, or moved within it. */
	writeSection(note: OwnedRef, section: OwnedRef, request: UpdateBlockRequest): BlockView {
		this.#write(note, (draft) => {
			const held = draft.blocks.find((one) => one.ref === section);
			if (!held) return draft;
			const written: BlockView = {
				...held,
				...(request.content === undefined
					? {}
					: { content: BlockDocumentSchema.parse(request.content) }),
				updated_at: new Date().toISOString()
			};
			if (request.after === undefined) {
				return {
					...draft,
					blocks: ordered(draft.blocks.map((one) => (one.ref === section ? written : one)))
				};
			}
			const rest = draft.blocks.filter((one) => one.ref !== section);
			const at = placeIn(rest, request.after);
			return { ...draft, blocks: ordered([...rest.slice(0, at), written, ...rest.slice(at)]) };
		});
		const after = this.draft(note)?.blocks.find((one) => one.ref === section);
		if (!after) throw new Error('That section is no longer in the change being offered.');
		return after;
	}

	dropSection(note: OwnedRef, section: OwnedRef): void {
		this.#write(note, (draft) => ({
			...draft,
			blocks: ordered(draft.blocks.filter((one) => one.ref !== section))
		}));
	}

	async #act<T>(what: () => Promise<T>, otherwise: string): Promise<T> {
		this.#busy = true;
		this.#says = null;
		try {
			return await what();
		} catch (error) {
			this.#says = serverMessage(error) ?? otherwise;
			throw error;
		} finally {
			this.#busy = false;
		}
	}

	/** Offer the draft on this note. Offering again on a note this person already
	 *  has an offer standing on writes that one. */
	async propose(note: OwnedRef, message: string): Promise<AmendmentView> {
		const draft = this.draft(note);
		if (!draft) throw new Error('There is nothing to offer here.');
		const said = message.trim();
		const request: ProposeAmendmentRequest = {
			note,
			...(said === '' ? {} : { message: said }),
			title: draft.title,
			tags: [...draft.tags],
			...(draft.edges === undefined ? {} : { edges: [...draft.edges] }),
			blocks: draft.blocks.map((block) => ({ ref: block.ref, content: block.content }))
		};
		const offered = await this.#act(
			() => api.proposeAmendment(request),
			'Sloppy could not offer that change. Try again in a moment.'
		);
		this.#letGo(note);
		await this.reread(note);
		return offered;
	}

	async withdraw(offer: AmendmentView): Promise<void> {
		await this.#act(
			() => api.withdrawAmendment(offer.ref),
			'Sloppy could not take that back. Try again in a moment.'
		);
		this.#letGo(offer.note);
		await this.reread(offer.note);
	}

	/** Take an offer in: the note's writing becomes the offer's, whole, and
	 *  whoever offered it joins the note's contributors. */
	async approve(offer: AmendmentView): Promise<NodeView> {
		const note = await this.#act(
			() => api.approveAmendment(offer.ref),
			'Sloppy could not take that change in. Try again in a moment.'
		);
		await this.reread(offer.note);
		await nodes.refetch(offer.note).catch(() => null);
		return note;
	}

	/** Turn one down. Nothing of it is kept. */
	async decline(offer: AmendmentView): Promise<void> {
		await this.#act(
			() => api.declineAmendment(offer.ref),
			'Sloppy could not turn that down. Try again in a moment.'
		);
		await this.reread(offer.note);
	}

	/** What the device is holding is left where it is: somebody signing out has
	 *  not given up writing that never reached Sloppy. */
	clear(): void {
		this.#epoch += 1;
		this.#standing.clear();
		this.#asked.clear();
		this.#drafts.clear();
		this.#opening.clear();
		this.#says = null;
		this.#busy = false;
	}
}

export const offers = new OffersStore();
