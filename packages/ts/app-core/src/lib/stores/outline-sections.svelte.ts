/**
 * The sections of the notes a reader has opened in the outline: what each one
 * says on its first line, and which notes are showing them.
 *
 * AI.md § "A Block Is a Section": the acts here are moving one within its note
 * and carrying one into another note.
 */

import { type BlockView, compareOrd, type OwnedRef } from '@sloppy/types';
import { sectionLines, type SectionSays, type TreeSection } from '@sloppy/ui';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { api } from '../api.js';
import { serverMessage } from './errors.js';

/** A section with no line to show for it: empty, or written in something this
 *  build has no words for. */
const BARE = 'A section';

const READING = 'Reading this note…';
const NOTHING = 'Nothing is written in this note yet';
const UNREAD = 'These sections could not be read. Tap to try again.';
const UNMOVED = 'That section could not be moved. Tap to read this note again.';

/** Moves asked for and answered on one note's stack. */
interface Moves {
	asked: number;
	answered: number;
}

function heldOf(stack: readonly BlockView[]): TreeSection[] {
	return [...stack]
		.sort((a, b) => compareOrd(a.ord, b.ord))
		.map((block) => ({ ref: block.ref, says: sectionLines(block.content)[0] ?? BARE }));
}

class OutlineSectionsStore {
	#shown = new SvelteSet<OwnedRef>();
	#held = new SvelteMap<OwnedRef, TreeSection[]>();
	/** Every section read, whole, so a surface that writes in one has what it
	 *  holds and not only what it says. `#held` keeps the order. */
	#rows = new SvelteMap<OwnedRef, BlockView>();
	#trouble = new SvelteMap<OwnedRef, string>();
	#inflight = new Map<OwnedRef, Promise<void>>();
	#moves = new Map<OwnedRef, Moves>();
	// A {@link clear} that lands mid-request must not be undone by the answer.
	#epoch = 0;
	#forWhom: string | null = null;

	get shown(): ReadonlySet<OwnedRef> {
		return this.#shown;
	}

	of(note: OwnedRef): readonly TreeSection[] | undefined {
		return this.#held.get(note);
	}

	/** The same stack, whole and in the same order, for a surface that draws what
	 *  is written in the note rather than a line of it. */
	stack(note: OwnedRef): readonly BlockView[] | undefined {
		const held = this.#held.get(note);
		if (held === undefined) return undefined;
		return held.flatMap((one) => {
			const row = this.#rows.get(one.ref);
			return row ? [row] : [];
		});
	}

	/** How many times this note's stack has been arranged, so a surface drawing
	 *  it can be opened again on the order it stands in now. */
	arranged(note: OwnedRef): number {
		return this.#moves.get(note)?.asked ?? 0;
	}

	/** Read a note's sections, whether or not anybody is showing them. */
	read(note: OwnedRef): Promise<void> {
		return this.#read(note);
	}

	says(note: OwnedRef): SectionSays {
		const trouble = this.#trouble.get(note);
		if (trouble !== undefined) return { says: trouble, again: true };
		const held = this.#held.get(note);
		if (held === undefined) return { says: READING, again: false };
		return { says: held.length === 0 ? NOTHING : '', again: false };
	}

	/** Showing a note draws whatever is in hand and reads it again behind that,
	 *  so a stack written in the note itself catches up here. */
	show(note: OwnedRef, show: boolean): void {
		if (!show) {
			this.#shown.delete(note);
			return;
		}
		this.#shown.add(note);
		void this.#read(note);
	}

	/** `after` is the section this one is to follow; null puts it first. The
	 *  stack moves at once; a refused write reads the note again. */
	move(note: OwnedRef, section: OwnedRef, after: OwnedRef | null): void {
		const held = this.#held.get(note);
		const at = held?.findIndex((one) => one.ref === section) ?? -1;
		if (!held || at < 0) return;
		const rest = held.filter((one) => one.ref !== section);
		const to = after === null ? 0 : rest.findIndex((one) => one.ref === after) + 1;
		if (to === 0 && after !== null) return;
		this.#held.set(note, [...rest.slice(0, to), held[at], ...rest.slice(to)]);
		this.#trouble.delete(note);
		this.#asked(note);

		const epoch = this.#epoch;
		void api.updateBlock(section, { after }).then(
			() => this.#answered(note, epoch),
			(err: unknown) => {
				if (!this.#answered(note, epoch)) return;
				void this.#read(note);
				this.#trouble.set(note, serverMessage(err) ?? UNMOVED);
			}
		);
	}

	/** Carry a section into `node`, out of whichever note holds it: `after` is
	 *  the section of `node` it is to follow, null its top. Both stacks move at
	 *  once; a refused write reads them again. */
	moveTo(section: OwnedRef, node: OwnedRef, after: OwnedRef | null): void {
		const from = this.#noteOf(section);
		if (from === undefined) return;
		if (from === node) {
			this.move(node, section, after);
			return;
		}
		const held = this.#held.get(from) ?? [];
		const carried = held.find((one) => one.ref === section);
		if (!carried) return;

		const into = this.#held.get(node);
		if (into) {
			const to = after === null ? 0 : into.findIndex((one) => one.ref === after) + 1;
			if (to === 0 && after !== null) return;
			this.#held.set(node, [...into.slice(0, to), carried, ...into.slice(to)]);
			this.#trouble.delete(node);
			this.#asked(node);
		}
		this.#held.set(
			from,
			held.filter((one) => one.ref !== section)
		);
		this.#trouble.delete(from);
		this.#asked(from);

		const epoch = this.#epoch;
		void api.updateBlock(section, { node, after }).then(
			() => {
				if (into) this.#answered(node, epoch);
				this.#answered(from, epoch);
			},
			(err: unknown) => {
				if (into) this.#answered(node, epoch);
				if (!this.#answered(from, epoch)) return;
				const says = serverMessage(err) ?? UNMOVED;
				void this.#read(from);
				this.#trouble.set(from, says);
				if (into) {
					void this.#read(node);
					this.#trouble.set(node, says);
				}
			}
		);
	}

	/** Nothing one person's outline holds belongs to the next. */
	mine(did: string | null): void {
		if (did === this.#forWhom) return;
		this.#forWhom = did;
		this.clear();
	}

	clear(): void {
		this.#epoch++;
		this.#shown.clear();
		this.#held.clear();
		this.#rows.clear();
		this.#trouble.clear();
		this.#inflight.clear();
		this.#moves.clear();
	}

	#noteOf(section: OwnedRef): OwnedRef | undefined {
		for (const [note, held] of this.#held) {
			if (held.some((one) => one.ref === section)) return note;
		}
		return undefined;
	}

	#asked(note: OwnedRef): void {
		const moves = this.#moves.get(note) ?? { asked: 0, answered: 0 };
		this.#moves.set(note, { ...moves, asked: moves.asked + 1 });
	}

	#answered(note: OwnedRef, epoch: number): boolean {
		if (epoch !== this.#epoch) return false;
		const moves = this.#moves.get(note) ?? { asked: 0, answered: 0 };
		this.#moves.set(note, { ...moves, answered: moves.answered + 1 });
		return true;
	}

	/** Whether a listing begun when the note stood at `since` still describes it:
	 *  nothing was moving then, and nothing has moved since. */
	#stands(note: OwnedRef, since: Moves): boolean {
		const now = this.#moves.get(note) ?? { asked: 0, answered: 0 };
		return (
			since.asked === since.answered && now.asked === since.asked && now.answered === since.answered
		);
	}

	#read(note: OwnedRef): Promise<void> {
		const already = this.#inflight.get(note);
		if (already) return already;
		const epoch = this.#epoch;
		const since = this.#moves.get(note) ?? { asked: 0, answered: 0 };
		this.#trouble.delete(note);
		const reading = api
			.listBlocks(note)
			.then((stack) => {
				if (epoch !== this.#epoch || !this.#stands(note, since)) return;
				for (const block of stack) this.#rows.set(block.ref, block);
				this.#held.set(note, heldOf(stack));
			})
			.catch((err: unknown) => {
				if (epoch !== this.#epoch) return;
				this.#trouble.set(note, serverMessage(err) ?? UNREAD);
			})
			.finally(() => {
				if (epoch !== this.#epoch) return;
				this.#inflight.delete(note);
			});
		this.#inflight.set(note, reading);
		return reading;
	}
}

export const outlineSections = new OutlineSectionsStore();
