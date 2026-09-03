/**
 * What people have said on a note. Every record lives in the store of whoever
 * wrote it, so this holds a read of those stores and never a copy — AI.md
 * § "Sloppy's Vocabulary Stays Out of the Identity Store".
 *
 * Discovery is per-identity and pull-only, so what a note can show is what the
 * reader and the identities they follow have written on it. Nothing here counts
 * or totals, because nobody can; docs/ARCHITECTURE.md § "Federating the graph".
 */

import type {
	CreateNoteCommentRequest,
	CreateNoteReactionRequest,
	NoteComment,
	NoteReaction,
	OwnedRef
} from '@sloppy/types';
import { SvelteMap } from 'svelte/reactivity';
import { api } from '../api.js';
import { serverMessage } from './errors.js';

export interface ConversationState {
	loading: boolean;
	/** True once a read has succeeded; stays true while another is in flight. */
	loaded: boolean;
	failed: boolean;
	/** The server's own words, where it gave any; the surface owes its own line
	 *  when this is absent. */
	error?: string;
}

const IDLE: ConversationState = { loading: false, loaded: false, failed: false };

const oldestFirst = (a: NoteComment, b: NoteComment) => a.created_at.localeCompare(b.created_at);

class ConversationStore {
	#comments = new SvelteMap<OwnedRef, NoteComment[]>();
	#reactions = new SvelteMap<OwnedRef, NoteReaction[]>();
	#state = new SvelteMap<OwnedRef, ConversationState>();
	#inflight = new Map<OwnedRef, Promise<void>>();
	// A sign-out that lands mid-request must not be undone by its answer.
	#epoch = 0;

	comments(node: OwnedRef): NoteComment[] {
		return this.#comments.get(node) ?? [];
	}

	reactions(node: OwnedRef): NoteReaction[] {
		return this.#reactions.get(node) ?? [];
	}

	status(node: OwnedRef): ConversationState {
		return this.#state.get(node) ?? IDLE;
	}

	/** Deduped: a note opened twice reads once, and one already read reads not
	 *  at all until {@link reload}. */
	load(node: OwnedRef): Promise<void> {
		const inflight = this.#inflight.get(node);
		if (inflight) return inflight;
		if (this.#state.get(node)?.loaded) return Promise.resolve();
		return this.reload(node);
	}

	/**
	 * Comments and reactions together: they are one thing on screen, and reading
	 * them apart would draw half a conversation while the other half arrives.
	 */
	reload(node: OwnedRef): Promise<void> {
		const inflight = this.#inflight.get(node);
		if (inflight) return inflight;
		const epoch = this.#epoch;
		const current = () => epoch === this.#epoch;
		const before = this.#state.get(node) ?? IDLE;
		this.#state.set(node, { ...before, loading: true, failed: false, error: undefined });
		const request = Promise.all([api.listComments(node), api.listReactions(node)])
			.then(([said, reacted]) => {
				if (!current()) return;
				this.#comments.set(node, [...said].sort(oldestFirst));
				// Kept as they arrived: a reaction carries no time of its own, so
				// the order the API assembled them in is the only one there is.
				this.#reactions.set(node, reacted);
				this.#state.set(node, { loading: false, loaded: true, failed: false });
			})
			.catch((err: unknown) => {
				if (current()) {
					this.#state.set(node, {
						loading: false,
						loaded: before.loaded,
						failed: true,
						error: serverMessage(err)
					});
				}
			})
			.finally(() => {
				if (current()) this.#inflight.delete(node);
			});
		this.#inflight.set(node, request);
		return request;
	}

	async say(request: CreateNoteCommentRequest): Promise<NoteComment> {
		const epoch = this.#epoch;
		const written = await api.addComment(request);
		if (epoch === this.#epoch) {
			this.#comments.set(written.node, [...this.comments(written.node), written].sort(oldestFirst));
		}
		return written;
	}

	async unsay(node: OwnedRef, commentId: NoteComment['comment_id']): Promise<void> {
		const epoch = this.#epoch;
		await api.removeComment(commentId);
		if (epoch !== this.#epoch) return;
		this.#comments.set(
			node,
			this.comments(node).filter((said) => said.comment_id !== commentId)
		);
	}

	async react(request: CreateNoteReactionRequest): Promise<NoteReaction> {
		const epoch = this.#epoch;
		const made = await api.addReaction(request);
		if (epoch !== this.#epoch) return made;
		const held = this.reactions(made.node).filter(
			(other) => other.reaction_id !== made.reaction_id
		);
		this.#reactions.set(made.node, [...held, made]);
		return made;
	}

	async unreact(node: OwnedRef, reactionId: NoteReaction['reaction_id']): Promise<void> {
		const epoch = this.#epoch;
		await api.removeReaction(reactionId);
		if (epoch !== this.#epoch) return;
		this.#reactions.set(
			node,
			this.reactions(node).filter((made) => made.reaction_id !== reactionId)
		);
	}

	/** After a sign-out or an erase: nothing read as one person is shown to the
	 *  next, and what a reader can see depends on who they are. */
	clear(): void {
		this.#epoch++;
		this.#comments.clear();
		this.#reactions.clear();
		this.#state.clear();
		this.#inflight.clear();
	}
}

export const conversation = new ConversationStore();
