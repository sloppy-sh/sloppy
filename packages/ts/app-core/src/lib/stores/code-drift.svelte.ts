/**
 * Which notes the code has moved under — DESIGN.md § "What the code left
 * behind". Nothing here is stored: a note carries what each file it was read
 * against said then, and this compares that to what those files say now.
 *
 * **Where the project is not open beside the notes, nothing is worked out.** A
 * note is then neither moved nor up to date, which is why the answer is one
 * set and never a third state.
 *
 * The canvas asks about a graph and a note surface about one note, and both
 * are answered off the same pass over the code, so a mark and the note it
 * opens cannot disagree.
 */

import { digestsIn, type Files } from '@sloppy/local';
import type { CodeReading, NodeView, OwnedRef } from '@sloppy/types';
import { type CodeNow, driftOf } from '@sloppy/vault';

const NONE: ReadonlySet<OwnedRef> = new Set();

class CodeDriftStore {
	#moved = $state.raw<ReadonlySet<OwnedRef>>(NONE);
	/** The project's files as the last read of the folder found them, so a
	 *  graph's worth of notes costs one pass over the code. */
	#now: CodeNow | null = null;
	#over: Files | null = null;
	#reads = -1;
	// An {@link CodeDriftStore.read} whose answer lands after another began, or
	// after a clear, is not the answer.
	#epoch = 0;

	/** The notes whose code has moved. Empty is also every canvas that cannot
	 *  reach the code at all. */
	get moved(): ReadonlySet<OwnedRef> {
		return this.#moved;
	}

	/**
	 * Read `notes` against the project's files. `reads` is how many times the
	 * folder has been read — `graphs.folderReads` — and a count this has not
	 * seen takes the files again rather than answering out of the last pass.
	 */
	async read(notes: readonly NodeView[], project: Files | undefined, reads: number): Promise<void> {
		const epoch = ++this.#epoch;
		if (!project) {
			this.#forgetTheFiles();
			this.#moved = NONE;
			return;
		}
		const now = this.#filesOf(project, reads);
		const signed = notes.filter((note) => (note.read_against?.length ?? 0) > 0);
		const drifted = await Promise.all(signed.map((note) => driftOf(note.read_against, now)));
		if (epoch !== this.#epoch) return;
		this.#moved = new Set(signed.flatMap((note, at) => (drifted[at].length > 0 ? [note.ref] : [])));
	}

	/** Which of the files one note was read against have moved, in path order.
	 *  Empty is a note nobody has read, and every note beside no project. */
	async under(
		readings: readonly CodeReading[] | undefined,
		project: Files | undefined,
		reads: number
	): Promise<string[]> {
		if (!project) return [];
		return driftOf(readings, this.#filesOf(project, reads));
	}

	/** Somebody has just read the code themselves, so what this last read of it
	 *  found is spent and the next answer reads it again. */
	again(): void {
		this.#forgetTheFiles();
	}

	/** Another folder is another project, and what was read out of the last one
	 *  says nothing about this one. */
	clear(): void {
		this.#epoch++;
		this.#forgetTheFiles();
		this.#moved = NONE;
	}

	#filesOf(project: Files, reads: number): CodeNow {
		if (this.#now === null || this.#over !== project || this.#reads !== reads) {
			this.#now = digestsIn(project);
			this.#over = project;
			this.#reads = reads;
		}
		return this.#now;
	}

	#forgetTheFiles(): void {
		this.#now = null;
		this.#over = null;
		this.#reads = -1;
	}
}

export const codeDrift = new CodeDriftStore();
