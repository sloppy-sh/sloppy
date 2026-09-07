/**
 * The sections of the notes a reader has opened in the outline: what each one
 * says on its first line, and which notes are showing them. Held for as long as
 * the app is up, so a note opened again in the same walk draws without asking.
 *
 * AI.md § "A Block Is a Section": moving one within its note is the only act
 * here.
 */

import { type BlockView, compareOrd, type OwnedRef, type Timestamp } from '@sloppy/types';
import { sectionLines, type TreeSection } from '@sloppy/ui';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { api } from '../api.js';
import { serverMessage } from './errors.js';

interface Held extends TreeSection {
	/** The stamp the section carried when it was read, which the next move of it
	 *  is conditioned on. */
	updated_at?: Timestamp;
}

/** A section with no line to show for it: empty, or written in something this
 *  build has no words for. */
const BARE = 'A section';

const READING = 'Reading this note…';
const NOTHING = 'Nothing is written in this note yet';
const UNREAD = 'These sections could not be read. Tap to try again.';
const UNMOVED = 'That section could not be moved. Tap to read this note again.';

function heldOf(stack: readonly BlockView[]): Held[] {
	return [...stack]
		.sort((a, b) => compareOrd(a.ord, b.ord))
		.map((block) => ({
			ref: block.ref,
			says: sectionLines(block.content)[0] ?? BARE,
			updated_at: block.updated_at
		}));
}

class OutlineSectionsStore {
	#shown = new SvelteSet<OwnedRef>();
	#held = new SvelteMap<OwnedRef, Held[]>();
	#reading = new SvelteSet<OwnedRef>();
	#trouble = new SvelteMap<OwnedRef, string>();
	#inflight = new Map<OwnedRef, Promise<void>>();
	// A {@link clear} that lands mid-request must not be undone by the answer.
	#epoch = 0;
	#forWhom: string | null = null;

	get shown(): ReadonlySet<OwnedRef> {
		return this.#shown;
	}

	of(note: OwnedRef): readonly TreeSection[] | undefined {
		return this.#held.get(note);
	}

	/** What stands under the note besides its sections; empty says nothing. */
	says(note: OwnedRef): string {
		const trouble = this.#trouble.get(note);
		if (trouble !== undefined) return trouble;
		if (this.#reading.has(note)) return READING;
		const held = this.#held.get(note);
		if (held === undefined) return READING;
		return held.length === 0 ? NOTHING : '';
	}

	show(note: OwnedRef, show: boolean): void {
		if (!show) {
			this.#shown.delete(note);
			return;
		}
		this.#shown.add(note);
		if (this.#held.has(note) && !this.#trouble.has(note)) return;
		void this.#read(note);
	}

	/** `after` is the section this one is to follow; null puts it first. The
	 *  stack moves at once and goes back where it was if the write is refused. */
	move(note: OwnedRef, section: OwnedRef, after: OwnedRef | null): void {
		const held = this.#held.get(note);
		const at = held?.findIndex((one) => one.ref === section) ?? -1;
		if (!held || at < 0) return;
		const rest = held.filter((one) => one.ref !== section);
		const to = after === null ? 0 : rest.findIndex((one) => one.ref === after) + 1;
		if (to === 0 && after !== null) return;
		const was = held;
		this.#held.set(note, [...rest.slice(0, to), held[at], ...rest.slice(to)]);
		this.#trouble.delete(note);

		const epoch = this.#epoch;
		void api
			.updateBlock(section, { after, expects: held[at].updated_at })
			.then((row) => {
				const now = epoch === this.#epoch ? this.#held.get(note) : undefined;
				if (!now) return;
				this.#held.set(
					note,
					now.map((one) => (one.ref === section ? { ...one, updated_at: row.updated_at } : one))
				);
			})
			.catch((err: unknown) => {
				if (epoch !== this.#epoch) return;
				this.#held.set(note, was);
				this.#trouble.set(note, serverMessage(err) ?? UNMOVED);
			});
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
		this.#reading.clear();
		this.#trouble.clear();
		this.#inflight.clear();
	}

	#read(note: OwnedRef): Promise<void> {
		const already = this.#inflight.get(note);
		if (already) return already;
		const epoch = this.#epoch;
		this.#reading.add(note);
		this.#trouble.delete(note);
		const reading = api
			.listBlocks(note)
			.then((stack) => {
				if (epoch !== this.#epoch) return;
				this.#held.set(note, heldOf(stack));
			})
			.catch((err: unknown) => {
				if (epoch !== this.#epoch) return;
				this.#trouble.set(note, serverMessage(err) ?? UNREAD);
			})
			.finally(() => {
				if (epoch !== this.#epoch) return;
				this.#reading.delete(note);
				this.#inflight.delete(note);
			});
		this.#inflight.set(note, reading);
		return reading;
	}
}

export const outlineSections = new OutlineSectionsStore();
