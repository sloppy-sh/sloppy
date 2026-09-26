/**
 * Asking a tool on this device to write a project's notes, in the order
 * docs/ARCHITECTURE.md § "Writing the notes in four steps" sets them:
 * what somebody asked for, the places a pass over the code proposes, the list
 * they settle, and the run.
 *
 * Nothing here parses and nothing here checks a place: the seam does both, in
 * both directions, and rejects with words this store shows.
 */

import type {
	DocumentingProgress,
	DocumentingTool,
	OwnedRef,
	PlaceDone,
	ProposedPlace,
	Tag
} from '@sloppy/types';
import { seam } from '../seam.svelte.js';
import { wordsFor } from './errors.js';
import { graphs } from './graphs.svelte.js';
import { nodes } from './nodes.svelte.js';

const UNREAD = 'Sloppy could not read the code just now. Try again.';
const UNWRITTEN = 'Sloppy could not write those notes just now. Try again.';
const UNTAGGED = 'Sloppy could not put those tags on just now. Try again.';

/** What the surface is asking for. `refining` is the list somebody settles,
 *  and `over` is a run that has ended either way. */
export type DocumentingStep = 'intent' | 'surveying' | 'refining' | 'running' | 'over';

/** What this device has to ask. `null` is a device that has not been asked, and
 *  `'untold'` one whose answer did not arrive — which is not the answer a device
 *  with no tool gives. */
export type DocumentingTools = readonly DocumentingTool[] | 'untold' | null;

class DocumentingStore {
	#step = $state<DocumentingStep>('intent');
	#said = $state('');
	#places = $state.raw<readonly ProposedPlace[]>([]);
	#progress = $state.raw<DocumentingProgress | null>(null);
	#trouble = $state.raw<string | null>(null);
	#stopping = $state(false);
	/** Unasked until somebody opens the surface — asking sooner would start a
	 *  tool nobody asked for. */
	#tools = $state.raw<DocumentingTools>(null);
	#of = $state.raw<OwnedRef | null>(null);
	/** An answer that lands after somebody stopped, or after another ask began,
	 *  is not an answer to what is on screen. */
	#epoch = 0;
	/** Whether the answer on its way was asked to end early, which is how an
	 *  empty survey is told from a survey that found nothing. */
	#ended = false;

	/** Whether this device can be asked at all. Absent everywhere but the shell
	 *  that can reach a tool, which is what keeps the offer off the web. */
	get reaches(): boolean {
		return seam().documenting() !== undefined;
	}

	get tools(): DocumentingTools {
		return this.#tools;
	}

	get step(): DocumentingStep {
		return this.#step;
	}

	get said(): string {
		return this.#said;
	}

	get places(): readonly ProposedPlace[] {
		return this.#places;
	}

	/** Where the run has got to, or `null` before one has begun. */
	get progress(): DocumentingProgress | null {
		return this.#progress;
	}

	/** What went wrong, in words meant for the person who asked. */
	get trouble(): string | null {
		return this.#trouble;
	}

	/** Whether an end has been asked for and has not landed yet. */
	get stopping(): boolean {
		return this.#stopping;
	}

	say(words: string): void {
		this.#said = words;
	}

	/**
	 * Somebody has opened this on `graph`. Another graph has not been asked this
	 * one's question, so what is held is let go of; the same one is picked up
	 * where it was left, run and all.
	 */
	async opened(graph: OwnedRef): Promise<void> {
		if (this.#of !== null && this.#of !== graph) this.clear();
		this.#of = graph;
		const held = this.#tools;
		if (held === null || held === 'untold') await this.lookForTools();
	}

	/** Ask this device what it has. An ask that goes wrong is told apart from a
	 *  device with no tool, which would send somebody to install one they have. */
	async lookForTools(): Promise<void> {
		const access = seam().documenting();
		if (!access) return;
		this.#tools = null;
		try {
			this.#tools = await access.tools();
		} catch {
			this.#tools = 'untold';
		}
	}

	/** Back to the words, keeping them, so somebody can ask for something else. */
	askAgain(): void {
		this.#epoch += 1;
		this.#places = [];
		this.#progress = null;
		this.#trouble = null;
		this.#step = 'intent';
	}

	/**
	 * Read the project against what was said and propose places. A survey
	 * somebody ended proposes none of what it had reached, so it leaves them
	 * back at their words rather than at an empty list.
	 */
	async survey(): Promise<void> {
		const access = seam().documenting();
		if (!access) return;
		const epoch = ++this.#epoch;
		this.#ended = false;
		this.#trouble = null;
		this.#progress = null;
		this.#places = [];
		this.#step = 'surveying';
		try {
			const found = await access.survey({ said: this.#said.trim() });
			if (epoch !== this.#epoch) return;
			if (this.#ended) {
				this.#step = 'intent';
				return;
			}
			this.#places = found;
			this.#step = 'refining';
		} catch (error) {
			if (epoch !== this.#epoch) return;
			this.#trouble = wordsFor(error) ?? UNREAD;
			this.#step = 'intent';
		}
	}

	/** Take a place off the list. */
	drop(path: string): void {
		this.#places = this.#places.filter((place) => place.path !== path);
	}

	/** A place somebody added themselves, which carries no reason because nobody
	 *  proposed it to them. One already on the list stays where it stands. */
	add(path: string): void {
		if (this.#places.some((place) => place.path === path)) return;
		this.#places = [...this.#places, { path }];
	}

	/** Take a tag off a place, so the run does not put it on. What survives here
	 *  is what the person allowed. */
	untag(path: string, tag: Tag): void {
		this.#places = this.#places.map((place) => {
			if (place.path !== path || place.tags === undefined) return place;
			const kept = place.tags.filter((held) => held !== tag);
			const next = { ...place };
			if (kept.length === 0) delete next.tags;
			else next.tags = kept;
			return next;
		});
	}

	/**
	 * Put the tags a run suggested on the note, as the person. They are their
	 * own write on their own note — the run left them beside the result rather
	 * than on it — and they go on alongside whatever the note already carries.
	 */
	async takeIn(done: PlaceDone): Promise<void> {
		const suggested = done.note?.suggested;
		if (!done.note || suggested === undefined || suggested.length === 0) return;
		const note = done.note.ref;
		try {
			// The request carries the whole set, so a note this device has not read
			// is read first: writing without its tags would take them off.
			const held = nodes.get(note) ?? (await nodes.fetch(note));
			if (!held) throw new Error('no such note');
			await nodes.update(note, { tags: [...held.tags, ...suggested] });
		} catch (error) {
			this.#trouble = wordsFor(error) ?? UNTAGGED;
			return;
		}
		this.#trouble = null;
		this.#tookIn(done.path);
	}

	/** The place's suggestion is spent once it is on the note. */
	#tookIn(path: string): void {
		const progress = this.#progress;
		if (progress === null) return;
		this.#progress = {
			...progress,
			places: progress.places.map((done) => {
				if (done.path !== path || !done.note) return done;
				const note = { ...done.note };
				delete note.suggested;
				return { ...done, note };
			})
		};
	}

	/** The place one step earlier or later in the order the run will write in. */
	move(path: string, by: -1 | 1): void {
		const at = this.#places.findIndex((place) => place.path === path);
		const to = at + by;
		if (at === -1 || to < 0 || to >= this.#places.length) return;
		const next = [...this.#places];
		[next[at], next[to]] = [next[to], next[at]];
		this.#places = next;
	}

	/**
	 * Write about the places that survived, in the order they stand in. What the
	 * run leaves is read back off the folder before the answer is shown, so a
	 * note it wrote is one somebody can open.
	 */
	async run(): Promise<void> {
		const access = seam().documenting();
		if (!access) return;
		const epoch = ++this.#epoch;
		this.#ended = false;
		this.#trouble = null;
		this.#progress = { stage: 'reading', places: [] };
		this.#step = 'running';
		try {
			const last = await access.run(
				{ intent: { said: this.#said.trim() }, places: [...this.#places] },
				(progress) => {
					if (epoch === this.#epoch) this.#progress = progress;
				}
			);
			await graphs.readFolderAgain();
			if (epoch !== this.#epoch) return;
			this.#progress = last;
			this.#trouble = last.trouble ?? null;
			this.#step = 'over';
		} catch (error) {
			if (epoch !== this.#epoch) return;
			this.#trouble = wordsFor(error) ?? UNWRITTEN;
			this.#step = 'refining';
		}
	}

	/** End whichever of the two is underway. */
	async stop(): Promise<void> {
		const access = seam().documenting();
		if (!access || this.#stopping) return;
		this.#ended = true;
		this.#stopping = true;
		try {
			await access.stop();
		} finally {
			this.#stopping = false;
		}
	}

	/** Another graph has not been asked this one's question. */
	forget(graph: OwnedRef): void {
		if (this.#of !== null && this.#of !== graph) this.clear();
	}

	clear(): void {
		if (this.#step === 'surveying' || this.#step === 'running') {
			void seam()
				.documenting()
				?.stop()
				.catch(() => {});
		}
		this.#epoch += 1;
		this.#ended = false;
		this.#of = null;
		this.#said = '';
		this.#places = [];
		this.#progress = null;
		this.#trouble = null;
		this.#tools = null;
		this.#step = 'intent';
	}
}

export const documenting = new DocumentingStore();
