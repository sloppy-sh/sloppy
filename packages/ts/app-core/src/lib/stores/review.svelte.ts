/**
 * What the code has left behind, for the graph in front of somebody —
 * DESIGN.md § "What the code left behind". A question they ask: nothing here
 * runs until they do, nothing is stored, and the signals are worked out by
 * `review()` in `@sloppy/vault` so this and the CLI cannot disagree.
 */

import type { Files } from '@sloppy/local';
import {
	type BlockDocument,
	type BlockView,
	CODE_SCHEME,
	graphOf,
	type NodeView,
	type OwnedRef
} from '@sloppy/types';
import { NOTE_TEMPLATES, writeTemplate } from '@sloppy/ui';
import {
	review as signalsOf,
	REVIEW_SIGNALS,
	type ReviewSignal,
	type ReviewSignalKind
} from '@sloppy/vault';
import { api } from '../api.js';
import { filesIn } from '../project-code.js';
import { serverMessage } from './errors.js';
import { graphHistory } from './history.svelte.js';
import { nodes } from './nodes.svelte.js';

const UNREAD = 'Sloppy could not read every note just now. Try again.';
const UNRECORDED = 'Sloppy could not note that. Try again in a moment.';
const UNWRITTEN = 'Sloppy could not start that note. Try again in a moment.';

/** Notes read at once. Enough to keep a folder's worth moving, few enough that
 *  the question does not take the app's every connection with it. */
const AT_ONCE = 6;

/** What a manifest at a folder says: this is a package the tree declares, and
 *  so a place of its own to have been written about. */
const MANIFESTS = ['package.json', 'Cargo.toml', 'pyproject.toml', 'go.mod'];

/**
 * The places in a project a note could be about: its top-level folders, and
 * every package the tree declares under them. A path a note anchors at or
 * inside answers for the whole entry, so the two granularities sit together —
 * one anchor anywhere in `apps/` answers for `apps`, and each package under it
 * still asks for itself.
 */
export function placesIn(paths: readonly string[]): string[] {
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a pure function's scratch, dropped before it returns.
	const places = new Set<string>();
	for (const path of paths) {
		const segments = path.split('/');
		if (segments.length > 1) places.add(segments[0]);
		const manifest = segments.pop();
		if (manifest !== undefined && segments.length > 0 && MANIFESTS.includes(manifest)) {
			places.add(segments.join('/'));
		}
	}
	return [...places].sort();
}

/** One signal, told from every other: a signal names a note, a path or both,
 *  and two of one kind on one note are told apart by the slot they are about. */
export function signalKey(signal: ReviewSignal): string {
	return [signal.kind, signal.note ?? '', signal.path ?? '', signal.direction ?? ''].join(' ');
}

/** What one act settles: a reading recorded on a note answers every path the
 *  code moved under it, so the rows about it are in the air together. */
export function actKey(signal: Pick<ReviewSignal, 'kind' | 'note' | 'path'>): string {
	return `${signal.kind} ${signal.note ?? signal.path ?? ''}`;
}

class ReviewStore {
	#signals = $state.raw<readonly ReviewSignal[]>([]);
	#of = $state.raw<OwnedRef | null>(null);
	#chosen = $state.raw<ReviewSignalKind | null>(null);
	#reading = $state(false);
	#acting = $state.raw<string | null>(null);
	#trouble = $state.raw<string | null>(null);
	// An {@link ask} whose answer lands after another began, or after a clear,
	// is not this graph's answer.
	#epoch = 0;

	/** The graph the answer in hand is about; `null` before anybody has asked. */
	get graph(): OwnedRef | null {
		return this.#of;
	}

	get reading(): boolean {
		return this.#reading;
	}

	/** What went wrong, in words meant for the person who asked. */
	get trouble(): string | null {
		return this.#trouble;
	}

	get signals(): readonly ReviewSignal[] {
		return this.#signals;
	}

	/** The kinds anything was found of, in the order `@sloppy/vault` names
	 *  them — which is the order the chips read in. */
	get kinds(): ReviewSignalKind[] {
		return REVIEW_SIGNALS.filter((kind) => this.#signals.some((one) => one.kind === kind));
	}

	get chosen(): ReviewSignalKind | null {
		return this.#chosen;
	}

	under(kind: ReviewSignalKind): ReviewSignal[] {
		return this.#signals.filter((one) => one.kind === kind);
	}

	/** Which row an act is in the air for, so the sheet says so on that row
	 *  alone. */
	get acting(): string | null {
		return this.#acting;
	}

	/**
	 * The notes the chosen signal names — what the canvas holds in ink while
	 * everything else dims. `undefined` is no question on the canvas at all:
	 * nothing chosen, and a signal about the project rather than about anybody's
	 * notes, which names none of them.
	 */
	get lit(): ReadonlySet<OwnedRef> | undefined {
		if (this.#chosen === null) return undefined;
		const named = new Set(
			this.under(this.#chosen)
				.map((one) => one.note)
				.filter((note) => note !== undefined)
		);
		return named.size === 0 ? undefined : named;
	}

	/** Choosing the chosen one again stops asking, the way a tag does. */
	choose(kind: ReviewSignalKind | null): void {
		this.#chosen = kind === this.#chosen ? null : kind;
	}

	/**
	 * Ask what the code has left behind of `graph`, over the notes on the canvas
	 * and the project's own files. Every note is read whole, so an answer that
	 * could not read one is no answer at all rather than a quieter one.
	 */
	async ask(graph: OwnedRef, notes: readonly NodeView[], project: Files): Promise<void> {
		const epoch = ++this.#epoch;
		const current = () => epoch === this.#epoch;
		this.#of = graph;
		this.#reading = true;
		this.#trouble = null;
		const mine = notes.filter((note) => graphOf(note) === graph);
		try {
			const [read, files] = await Promise.all([sectionsOf(mine), filesIn(project)]);
			const signals = await signalsOf({
				notes: mine.map((note) => ({
					ref: note.ref,
					...(note.checked === undefined ? {} : { checked: note.checked }),
					sections: read.get(note.ref) ?? []
				})),
				projectTop: placesIn(files),
				changed: (checked, paths) => graphHistory.changedSince(checked, paths)
			});
			if (!current()) return;
			this.#signals = signals;
			// Asking IS choosing one — DESIGN.md § "What the code left behind" — so
			// an answer arrives with the first of them already being asked.
			if (this.#chosen === null || !signals.some((one) => one.kind === this.#chosen)) {
				this.#chosen = this.kinds[0] ?? null;
			}
		} catch (error) {
			if (!current()) return;
			this.#signals = [];
			this.#chosen = null;
			this.#trouble = serverMessage(error) ?? UNREAD;
		} finally {
			if (current()) this.#reading = false;
		}
	}

	/**
	 * Record that this note's reasoning still holds against the version the
	 * folder stands on now. Nothing else is written, and the note stops being
	 * one the code has moved under.
	 */
	async stillTrue(note: OwnedRef): Promise<void> {
		const row = actKey({ kind: 'anchor-changed', note });
		this.#acting = row;
		this.#trouble = null;
		try {
			const at = await graphHistory.versionNow();
			if (at === undefined) {
				this.#trouble = UNRECORDED;
				return;
			}
			await nodes.update(note, { checked: at });
			this.#settle((one) => !(one.kind === 'anchor-changed' && one.note === note));
		} catch (error) {
			this.#trouble = serverMessage(error) ?? UNRECORDED;
		} finally {
			if (this.#acting === row) this.#acting = null;
		}
	}

	/**
	 * Start a walkthrough about a place in the code nobody has written about:
	 * under the graph's own first branch, which is where a project's notes hang,
	 * anchored at the path and shaped for somebody to write into. Resolves with
	 * the note, or `null` where it could not be written.
	 */
	async writeAbout(path: string): Promise<OwnedRef | null> {
		const graph = this.#of;
		if (graph === null) return null;
		const row = actKey({ kind: 'code-without-note', path });
		this.#acting = row;
		this.#trouble = null;
		try {
			const top = nodes.region({ graph })[0]?.ref;
			const note = await nodes.create({
				title: path,
				from: top === undefined ? { relation: 'branch', graph } : { relation: 'under', note: top }
			});
			const anchor = await api.createBlock({ node: note.ref, content: anchoredAt(path) });
			const walkthrough = NOTE_TEMPLATES.find((shape) => shape.id === 'walkthrough');
			if (walkthrough) {
				await writeTemplate(walkthrough, { node: note.ref, after: anchor.ref }, api.createBlock);
			}
			this.#settle((one) => !(one.kind === 'code-without-note' && one.path === path));
			return note.ref;
		} catch (error) {
			this.#trouble = serverMessage(error) ?? UNWRITTEN;
			return null;
		} finally {
			if (this.#acting === row) this.#acting = null;
		}
	}

	/** What an act has settled is no longer a thing to do; where it was the last
	 *  of its kind, the question moves on to the next one rather than leaving
	 *  somebody looking at a list that is not there. */
	#settle(keep: (signal: ReviewSignal) => boolean): void {
		this.#signals = this.#signals.filter(keep);
		if (this.#chosen !== null && !this.#signals.some((one) => one.kind === this.#chosen)) {
			this.#chosen = this.kinds[0] ?? null;
		}
	}

	/** Another graph has not been asked this one's question. */
	forget(graph: OwnedRef): void {
		if (this.#of !== null && this.#of !== graph) this.clear();
	}

	clear(): void {
		this.#epoch++;
		this.#signals = [];
		this.#of = null;
		this.#chosen = null;
		this.#reading = false;
		this.#acting = null;
		this.#trouble = null;
	}
}

/** A section holding the place in the code, written as the link an anchor is. */
function anchoredAt(path: string): BlockDocument {
	return {
		type: 'doc',
		content: [
			{
				type: 'paragraph',
				content: [
					{
						type: 'text',
						marks: [{ type: 'link', attrs: { href: `${CODE_SCHEME}${path}` } }],
						text: path
					}
				]
			}
		]
	};
}

/** Every note's stack, a few notes at a time. One that cannot be read throws,
 *  because a missing section is a signal nobody is shown. */
async function sectionsOf(notes: readonly NodeView[]): Promise<Map<OwnedRef, BlockView[]>> {
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- read once and handed back whole; nothing reads it as it fills.
	const read = new Map<OwnedRef, BlockView[]>();
	for (let at = 0; at < notes.length; at += AT_ONCE) {
		const batch = notes.slice(at, at + AT_ONCE);
		const stacks = await Promise.all(batch.map((note) => api.listBlocks(note.ref)));
		batch.forEach((note, which) => read.set(note.ref, stacks[which]));
	}
	return read;
}

export const review = new ReviewStore();
