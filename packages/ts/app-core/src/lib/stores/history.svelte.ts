/**
 * The states the graph in front of somebody has been in: what has changed since
 * the version they last kept, the versions themselves, the lines of work they
 * stand on, and what is different between any two of them.
 *
 * `History` in `@sloppy/local` declares every act and what its answer means;
 * the shell implements it over the folder. Absent is a platform that keeps no
 * history, and every getter here answers empty.
 */

import type { Branch, ChangedBetween, Commit, ConflictSide, History } from '@sloppy/local';
import type { BlockView, NodeView, OwnedRef } from '@sloppy/types';
import { api, resetApi } from '../api.js';
import { runtime } from '../runtime.js';
import { serverMessage } from './errors.js';

/** How many versions a page of the log holds. */
const PAGE = 30;

/** A state to read or compare: a version kept, or the folder as it stands where
 *  there is no commit. */
export type StateAsked = string | undefined;

/** One note both sides of a merge changed, with each section as each side has
 *  it. A section absent from a side is one that side does not have at all. */
export interface NoteInTwoVersions {
	/** As the history names it, which is what settles it. */
	path: string;
	ref: OwnedRef;
	title: string;
	sections: SectionInTwoVersions[];
}

export interface SectionInTwoVersions {
	ulid: string;
	/** The section as it stands in the folder, which is this line's. */
	mine?: BlockView;
	theirs?: BlockView;
}

/** `@sloppy/local` reads a folder, and a page that never opens one should not
 *  carry it. */
async function local() {
	return import('@sloppy/local');
}

/** The words an act came back with. A history and a graph on this device both
 *  refuse in words fit to show. */
function said(err: unknown): string {
	const words = serverMessage(err);
	if (words) return words;
	if (err instanceof Error && err.message) return err.message;
	return 'That did not work. Try again in a moment.';
}

class HistoryStore {
	#busy = $state(false);
	#says = $state<string | null>(null);
	#commits = $state<Commit[]>([]);
	#cursor = $state<string | undefined>(undefined);
	#branches = $state<Branch[]>([]);
	#at = $state<string | undefined>(undefined);
	#line = $state<string | undefined>(undefined);
	#ahead = $state(0);
	#changed = $state<ChangedBetween | null>(null);
	#conflicts = $state<string[]>([]);
	/** The line a merge was taking in, while any of it is still unsettled. */
	#taking = $state<{ name: string; head: string } | null>(null);
	#epoch = 0;

	/** Whether this platform keeps the states a graph has been in at all. */
	get keeps(): boolean {
		return runtime.history() !== undefined;
	}

	get busy(): boolean {
		return this.#busy;
	}

	/** Why the last act did not happen, in the words it gave. */
	get says(): string | null {
		return this.#says;
	}

	/** Newest first. */
	get versions(): readonly Commit[] {
		return this.#commits;
	}

	/** Whether there are older versions than the ones read so far. */
	get older(): boolean {
		return this.#cursor !== undefined;
	}

	get lines(): readonly Branch[] {
		return this.#branches;
	}

	/** The version the folder stands on; absent before the first one is kept. */
	get at(): string | undefined {
		return this.#at;
	}

	/** The line of work the folder is on. */
	get line(): string | undefined {
		return this.#line;
	}

	/** How far this line is ahead of wherever it is also kept; `0` is a folder
	 *  that is only here. */
	get ahead(): number {
		return this.#ahead;
	}

	/** What has changed since the version the folder stands on; `null` before
	 *  it has been read. */
	get changed(): ChangedBetween | null {
		return this.#changed;
	}

	/** Whether anything at all has changed since that version. */
	get unkept(): boolean {
		const changed = this.#changed;
		return (
			changed !== null &&
			(changed.notes.length > 0 || changed.pictures.added > 0 || changed.pictures.removed > 0)
		);
	}

	/** The notes a merge left in two versions, as the history names them. */
	get inTwoVersions(): readonly string[] {
		return this.#conflicts;
	}

	/** The line a merge is in the middle of taking in. */
	get taking(): string | null {
		return this.#taking?.name ?? null;
	}

	clear(): void {
		this.#epoch += 1;
		this.#busy = false;
		this.#says = null;
		this.#commits = [];
		this.#cursor = undefined;
		this.#branches = [];
		this.#at = undefined;
		this.#line = undefined;
		this.#ahead = 0;
		this.#changed = null;
		this.#conflicts = [];
		this.#taking = null;
	}

	/** Everything the surface shows: the versions, the lines, and what has
	 *  changed since the one the folder stands on. */
	async read(): Promise<void> {
		const history = runtime.history();
		if (!history) return;
		const at = ++this.#epoch;
		this.#busy = true;
		this.#says = null;
		try {
			const [status, page, branches, commit] = await Promise.all([
				history.status(),
				history.log(PAGE),
				history.branches(),
				history.currentCommit()
			]);
			if (at !== this.#epoch) return;
			this.#line = status.branch;
			this.#ahead = status.ahead;
			this.#commits = page.commits;
			this.#cursor = page.cursor;
			this.#branches = branches;
			this.#at = commit;
			this.#changed = await this.between(commit, undefined);
			if (at !== this.#epoch) return;
		} catch (err) {
			if (at === this.#epoch) this.#says = said(err);
		} finally {
			if (at === this.#epoch) this.#busy = false;
		}
	}

	/** The page of older versions after the ones already read. */
	async readOlder(): Promise<void> {
		const history = runtime.history();
		const cursor = this.#cursor;
		if (!history || cursor === undefined) return;
		const at = this.#epoch;
		try {
			const page = await history.log(PAGE, cursor);
			if (at !== this.#epoch) return;
			this.#commits = [...this.#commits, ...page.commits];
			this.#cursor = page.cursor;
		} catch (err) {
			if (at === this.#epoch) this.#says = said(err);
		}
	}

	/** Keep what is in the folder as a version. Answers whether anything was
	 *  kept: nothing to keep is not a failure. */
	async keep(message: string): Promise<boolean> {
		return this.act(async (history) => {
			const kept = await history.commit(message);
			return kept !== undefined;
		});
	}

	/** A line of work starting at the version the folder stands on. The folder
	 *  stays where it is. */
	async startLine(name: string): Promise<boolean> {
		return this.act(async (history) => {
			await history.branch(name);
			return true;
		});
	}

	/** The folder becomes that line's. */
	async workOn(name: string): Promise<boolean> {
		return this.act(async (history) => {
			await history.switch(name);
			return true;
		});
	}

	/** Take a line's versions into the one the folder is on. Answers false where
	 *  notes are left in two versions for somebody to settle. */
	async bringIn(name: string): Promise<boolean> {
		return this.act(async (history) => {
			const result = await history.merge(name);
			if (result.merged) return true;
			const head = (await history.branches()).find((one) => one.name === name)?.head;
			this.#conflicts = [...result.conflicts];
			this.#taking = head === undefined ? null : { name, head };
			return false;
		});
	}

	/** One note in two versions, taken whole from one side. */
	async settle(path: string, side: ConflictSide): Promise<boolean> {
		return this.act(async (history) => {
			await history.resolve(path, side);
			this.#conflicts = this.#conflicts.filter((held) => held !== path);
			return true;
		});
	}

	/**
	 * One note in two versions, settled section by section: the sections taken
	 * from the other line are written into the note, and what stands in the
	 * folder afterwards is the version kept.
	 */
	async settleSections(note: NoteInTwoVersions, takeTheirs: ReadonlySet<string>): Promise<boolean> {
		return this.act(async (history) => {
			// Settled first, and written into after: settling a note takes it whole
			// from one side, so anything written before that is written over.
			await history.resolve(note.path, 'mine');
			this.#conflicts = this.#conflicts.filter((held) => held !== note.path);
			let after: OwnedRef | undefined;
			for (const section of note.sections) {
				const theirs = takeTheirs.has(section.ulid);
				if (theirs && section.theirs && section.mine) {
					await api.updateBlock(section.mine.ref, { content: section.theirs.content });
				} else if (theirs && section.theirs) {
					await api.createBlock({
						node: note.ref,
						content: section.theirs.content,
						...(after === undefined ? {} : { after })
					});
				} else if (theirs && section.mine) {
					await api.deleteBlock(section.mine.ref);
				}
				const standing = section.mine?.ref ?? undefined;
				if (standing !== undefined) after = standing;
			}
			return true;
		});
	}

	/** What both sides of the merge have of one note left in two versions. */
	async inTwo(path: string): Promise<NoteInTwoVersions | null> {
		const taking = this.#taking;
		const history = runtime.history();
		if (!taking || !history) return null;
		const { graphAsItWas } = await local();
		const theirs = await graphAsItWas(await history.readAt(taking.head));
		const ulid = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
		const owner = (await theirs.me())?.did;
		if (!owner) return null;
		const ref = `${owner}/${ulid}` as OwnedRef;
		const [mine, said, here, there] = await Promise.all([
			api.listBlocks(ref).catch(() => [] as BlockView[]),
			theirs.listBlocks(ref).catch(() => [] as BlockView[]),
			api.getNode(ref).catch(() => null),
			theirs.getNode(ref).catch(() => null)
		]);
		// Anything in the folder can be left in two versions, and only a note is
		// settled section by section.
		const note = here ?? there;
		if (!note) return null;
		const ours = new Map(mine.map((one) => [localPart(one.ref), one]));
		const yours = new Map(said.map((one) => [localPart(one.ref), one]));
		const sections = [...new Set([...ours.keys(), ...yours.keys()])].map((held) => {
			const ourSection = ours.get(held);
			const yourSection = yours.get(held);
			return {
				ulid: held,
				...(ourSection ? { mine: ourSection } : {}),
				...(yourSection ? { theirs: yourSection } : {})
			};
		});
		return { path, ref, title: note?.title ?? '', sections };
	}

	/** What changed between two states, note by note and section by section.
	 *  `undefined` on either side is the folder as it stands. */
	async between(before: StateAsked, after: StateAsked): Promise<ChangedBetween | null> {
		const history = runtime.history();
		if (!history) return null;
		const { changedBetween } = await local();
		const [was, now] = await Promise.all([this.vaultAt(before), this.vaultAt(after)]);
		if (!was || !now) return null;
		return changedBetween(was, now);
	}

	/** Every note a version had, for the canvas and the outline to draw. */
	async notesAt(commit: string): Promise<NodeView[]> {
		const history = runtime.history();
		if (!history) return [];
		const { graphAsItWas } = await local();
		const then = await graphAsItWas(await history.readAt(commit));
		const graph = await then.graphHere();
		const roots = await then.listNodes({ graph });
		const trees = await Promise.all(roots.map((root) => then.listNodes({ origin: root.ref })));
		const held: Record<string, NodeView> = {};
		for (const note of [...roots, ...trees.flat()]) held[note.ref] = note;
		return Object.values(held);
	}

	private async vaultAt(commit: StateAsked) {
		const history = runtime.history();
		if (!history) return null;
		if (commit !== undefined) return history.readAt(commit);
		const { graphAsItIs } = await local();
		return graphAsItIs(api);
	}

	/** An act, with what it refuses in the words it gave, and the surface read
	 *  again after it. */
	private async act(what: (history: History) => Promise<boolean>): Promise<boolean> {
		const history = runtime.history();
		if (!history) return false;
		this.#busy = true;
		this.#says = null;
		try {
			const done = await what(history);
			// An act moves the folder underneath whatever is serving the graph out
			// of it, so it is served again before anything is read back.
			resetApi();
			await this.read();
			return done;
		} catch (err) {
			this.#says = said(err);
			return false;
		} finally {
			this.#busy = false;
		}
	}
}

function localPart(ref: OwnedRef): string {
	return ref.slice(ref.lastIndexOf('/') + 1);
}

export const graphHistory = new HistoryStore();
