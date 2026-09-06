/**
 * Finding a note again from the graph: what somebody has typed, the notes on
 * the canvas it already reaches, and the writing the server finds inside them.
 *
 * The two halves answer at different speeds on purpose. An address or a title
 * is matched against what is already in hand, so the list moves with the
 * keystroke; the writing inside notes is asked for once the typing stops.
 */

import { graphOf, type NodeView, type OwnedRef, type SearchHit } from '@sloppy/types';
import { api } from '../api.js';
import { carries } from '../note-find.js';
import { serverMessage } from './errors.js';
import { graphs } from './graphs.svelte.js';
import { nodes } from './nodes.svelte.js';

/** How long the typing stops before the writing inside notes is asked for. */
const PAUSE = 200;

/** Enough to find the one meant, never a list to read through. */
const MOST = 25;

function asHit(note: NodeView): SearchHit {
	return {
		note: note.ref,
		address: note.address,
		graph: graphOf(note),
		title: note.title,
		snippet: '',
		held: false
	};
}

class FindStore {
	#query = $state('');
	#hits = $state<readonly SearchHit[]>([]);
	/** The words the writing inside notes has been answered for. */
	#answered = $state<string | null>(null);
	#looking = $state(false);
	#unreadable = $state<string | null>(null);
	#timer: ReturnType<typeof setTimeout> | null = null;
	// An answer on its way back for words nobody is typing any more is dropped.
	#epoch = 0;

	#needle = $derived(this.#query.trim().toLowerCase());

	#reached = $derived.by(() => {
		const needle = this.#needle;
		if (!needle) return [] as SearchHit[];
		const out: SearchHit[] = [];
		const walk = (list: NodeView[]): void => {
			for (const note of list) {
				if (carries(note, needle)) out.push(asHit(note));
				walk(nodes.children(note.ref));
			}
		};
		// A graph's region is its branch roots; everything under them is walked to.
		for (const graph of graphs.onCanvas) walk(nodes.region({ graph }));
		return out;
	});

	/** What the server found, kept to the graphs standing on the canvas — and to
	 *  what the reader holds of somebody else's, which stands in no graph of
	 *  theirs. */
	#kept = $derived.by(() => {
		const canvas = new Set(graphs.onCanvas);
		return this.#hits.filter((hit) => hit.held || canvas.has(hit.graph));
	});

	#merged = $derived.by(() => {
		if (!this.#needle) return [] as SearchHit[];
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to this computation and thrown away with it; the derived IS the reactivity.
		const inside = new Map(this.#kept.map((hit) => [hit.note, hit]));
		const rows = this.#reached.map((row) => {
			const also = inside.get(row.note);
			if (!also) return row;
			inside.delete(row.note);
			return { ...row, snippet: also.snippet };
		});
		return [...rows, ...inside.values()];
	});

	get query(): string {
		return this.#query;
	}

	/** What the words reach, the numbers and titles already in hand first. */
	get found(): readonly SearchHit[] {
		return this.#merged.slice(0, MOST);
	}

	/** Whether more is still to come for what has been typed. */
	get looking(): boolean {
		return this.#looking;
	}

	/** True once nothing more is coming, which is the only moment a surface may
	 *  say there is no such note. */
	get settled(): boolean {
		return this.#needle !== '' && this.#answered === this.#needle;
	}

	/** Why the writing inside notes could not be read, in words fit to show. */
	get unreadable(): string | null {
		return this.#unreadable;
	}

	/**
	 * The note an address typed resolves to, read inside the graph the reader is
	 * in — one address means one note there, which is what makes Enter safe.
	 * Where that graph has none, an address held by exactly one graph on the
	 * canvas is still unambiguous; anything else answers nothing.
	 */
	get exact(): OwnedRef | null {
		const needle = this.#needle;
		if (!needle) return null;
		const at = this.#merged.filter((row) => row.address === needle);
		const here = at.filter((row) => row.graph === graphs.current);
		if (here.length === 1) return here[0].note;
		return at.length === 1 ? at[0].note : null;
	}

	type(words: string): void {
		if (words === this.#query) return;
		this.#query = words;
		this.#stop();
		this.#hits = [];
		this.#answered = null;
		this.#unreadable = null;
		const asked = words.trim();
		if (asked === '') {
			this.#looking = false;
			return;
		}
		this.#looking = true;
		this.#timer = setTimeout(() => void this.#ask(asked), PAUSE);
	}

	clear(): void {
		this.#stop();
		this.#query = '';
		this.#hits = [];
		this.#answered = null;
		this.#looking = false;
		this.#unreadable = null;
	}

	#stop(): void {
		this.#epoch += 1;
		if (this.#timer !== null) clearTimeout(this.#timer);
		this.#timer = null;
	}

	async #ask(asked: string): Promise<void> {
		const epoch = this.#epoch;
		this.#timer = null;
		try {
			const hits = await api.searchNotes(asked);
			if (epoch !== this.#epoch) return;
			this.#hits = hits;
			this.#answered = asked.toLowerCase();
		} catch (error) {
			if (epoch !== this.#epoch) return;
			this.#unreadable =
				serverMessage(error) ?? 'Sloppy could not look through your notes just now. Try again.';
		} finally {
			if (epoch === this.#epoch) this.#looking = false;
		}
	}
}

export const find = new FindStore();
