/**
 * The states the graph in front of somebody has been in: what has changed since
 * the version they last kept, the versions themselves, the lines of work they
 * stand on, and what is different between any two of them.
 *
 * `History` in `@sloppy/local` declares every act and what its answer means;
 * the shell implements it over the folder. Absent is a platform that keeps no
 * history, and every getter here answers empty.
 */

import type {
	Branch,
	ChangedBetween,
	Commit,
	ConflictSide,
	Credential,
	GraphCommit,
	History,
	HistoryStatus,
	MergeResult,
	Remote
} from '@sloppy/local';
import type { BlockView, NodeView, OwnedRef } from '@sloppy/types';
import { api, resetApi } from '../api.js';
import { runtime } from '../runtime.js';
import { wordsFor } from './errors.js';
import { graphs } from './graphs.svelte.js';
import { nodes } from './nodes.svelte.js';
import { outlineSections } from './outline-sections.svelte.js';
import { tags } from './tags.svelte.js';

/** How many versions a page of the log holds. */
const PAGE = 30;

/** How much of a version's name is the one a person reads and cites. */
const SHORT_NAME = 8;

/** A merge the folder is part-way through, as the folder itself says it — so it
 *  is still here after the app has been closed and opened again. */
export type MergeUnderway = NonNullable<HistoryStatus['merging']>;

/** A state to read or compare: a version kept, or the folder as it stands where
 *  there is no commit. */
export type StateAsked = string | undefined;

/** The whole folder as one state of it had it — `Vault` in `@sloppy/vault`,
 *  which a page reaches only through the history. */
type FolderAt = Awaited<ReturnType<History['readAt']>>;

/** What changed between two states, with the notes that went as the earlier
 *  state drew them: the later state is what a canvas holds, so a note that is
 *  no longer there can only be put back where it was from here. */
export interface DifferenceBetween extends ChangedBetween {
	gone: NodeView[];
}

/** One note both sides of a merge changed, with each section as each side has
 *  it. A section absent from a side is one that side does not have at all. */
export interface NoteInTwoVersions {
	/** As the history names it, which is what settles it. */
	path: string;
	ref: OwnedRef;
	title: string;
	sections: SectionInTwoVersions[];
}

/** What an act with somewhere else said: what it did, or what it would not do
 *  and what to try instead. */
export interface ElsewhereSaid {
	words: string;
	refused: boolean;
}

/** One place a folder is also kept, under the name a person reads it by. */
export interface KeptElsewhere {
	/** What this folder calls it, which is what an act is asked for by. */
	name: string;
	/** What a person calls it: the host it is at, else {@link KeptElsewhere.name}. */
	at: string;
}

/** How far the line the folder is on is from where it stands at one place: what
 *  a put would send there, and what a take would bring back. */
export interface Standing {
	ahead: number;
	behind: number;
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

/** Everything drawn out of the folder, read again: an act leaves the folder at
 *  another state of itself. */
async function readTheGraphAgain(): Promise<void> {
	await nodes.readAgain();
	const counted = graphs.onCanvas.filter((graph) => tags.status(graph).loaded);
	const showing = [...outlineSections.shown].filter((note) => nodes.get(note) !== undefined);
	await Promise.all([
		...counted.map((graph) => tags.reload(graph).catch(() => {})),
		...showing.map((note) => outlineSections.read(note))
	]);
}

/** The words an act came back with. A history and a graph on this device both
 *  refuse in words fit to show. */
function said(err: unknown): string {
	return wordsFor(err) ?? 'That did not work. Try again in a moment.';
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
	#changed = $state<DifferenceBetween | null>(null);
	#dirty = $state(false);
	#picture = $state<GraphCommit[]>([]);
	#drawnCursor = $state<string | undefined>(undefined);
	#remotes = $state<Remote[]>([]);
	#places = $state<KeptElsewhere[]>([]);
	#behind = $state(0);
	#upstream = $state<string | undefined>(undefined);
	#elsewhere = $state<ElsewhereSaid | null>(null);
	#signs = $state(false);
	#merging = $state<MergeUnderway | null>(null);
	/** Notes the history has already been asked to settle, while their sections
	 *  are still being written. */
	#taken = new Set<string>();
	#epoch = 0;

	/** Whether this platform keeps the states a graph has been in at all. */
	get keeps(): boolean {
		return runtime.history() !== undefined;
	}

	get busy(): boolean {
		return this.#busy;
	}

	/**
	 * Whether this platform can draw the whole history rather than the one line
	 * the folder is on, and reach the places it is also kept. False is a shell
	 * whose history has none of it, and nothing about any of it is offered.
	 */
	get draws(): boolean {
		return runtime.history()?.graph !== undefined;
	}

	/** Why the last act did not happen, in the words it gave. */
	get says(): string | null {
		return this.#says;
	}

	/** What the last act with somewhere else did, or would not do, in words for
	 *  whoever asked for it. `null` before one has been taken. */
	get elsewhereSaid(): ElsewhereSaid | null {
		return this.#elsewhere;
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

	/** Every version across every line, newest first and never above what it
	 *  springs from. Empty where {@link draws} is false. */
	get picture(): readonly GraphCommit[] {
		return this.#picture;
	}

	/** Whether the picture holds older versions than the ones read so far. */
	get morePicture(): boolean {
		return this.#drawnCursor !== undefined;
	}

	/** Whether this folder signs what it keeps, which is what makes a version
	 *  with no signature worth marking. */
	get signs(): boolean {
		return this.#signs;
	}

	/** Where else this folder is kept, each under the name a person reads it by:
	 *  the host it is at, and what this folder calls it where the address names
	 *  no host. */
	get places(): readonly KeptElsewhere[] {
		return this.#places;
	}

	/** How far the line the folder is on is behind wherever it is also kept;
	 *  `0` is a folder that is only here. */
	get behind(): number {
		return this.#behind;
	}

	/** The line, somewhere else, that the one the folder is on follows. */
	get follows(): string | undefined {
		return this.#upstream;
	}

	/** Which of the places the folder is kept the line it is on follows; absent
	 *  where it follows none. {@link ahead} and {@link behind} are measured from
	 *  there and say nothing about any other place. */
	get followsPlace(): string | undefined {
		const at = this.#upstream?.indexOf('/') ?? -1;
		return at > 0 ? this.#upstream?.slice(0, at) : undefined;
	}

	/**
	 * How far the line the folder is on is from where it stands at one of the
	 * places it is kept — the line it follows there, which is the one a put and
	 * a take are with. `undefined` where this device has not heard what that
	 * place holds, or has not read far enough back to say, and nothing is said
	 * of a distance nobody can stand behind.
	 */
	standingAt(place: string): Standing | undefined {
		if (place === this.followsPlace) return { ahead: this.#ahead, behind: this.#behind };
		const here = this.#at;
		const line = this.#line;
		if (here === undefined || line === undefined) return undefined;
		const there = this.#branches.find((one) => one.name === `${place}/${this.followedLine(line)}`);
		return there === undefined ? undefined : apart(here, there.head, this.#picture);
	}

	/** The line, wherever the folder is kept, that the one it is on is the same
	 *  line as: the one it follows by name, which need not be its own. */
	private followedLine(line: string): string {
		const named = this.#upstream;
		const at = named?.indexOf('/') ?? -1;
		return at > 0 && named !== undefined ? named.slice(at + 1) : line;
	}

	/** The version the folder stands on; absent before the first one is kept. */
	get at(): string | undefined {
		return this.#at;
	}

	/** The line of work the folder is on. */
	get line(): string | undefined {
		return this.#line;
	}

	/**
	 * The version the folder stands on, asked for now rather than read off what
	 * a page last drew. `undefined` where this platform keeps no history, where
	 * nothing has been kept yet, and where the folder cannot say — a surface
	 * that records a version cannot record one it is not sure of.
	 */
	async versionNow(): Promise<string | undefined> {
		try {
			return await runtime.history()?.currentCommit();
		} catch {
			return undefined;
		}
	}

	/**
	 * Which of `paths` a version kept after `commit` has touched, in the order
	 * they were given. They are spelled from the root of what the history keeps,
	 * which is where an anchor into code is written from.
	 *
	 * Empty is nothing to say: a platform that keeps no history, one whose
	 * history cannot answer this, and a version this folder has never been on —
	 * which is a note confirmed somewhere else, and not something to tell
	 * anybody the code has moved over.
	 */
	async changedSince(commit: string, paths: readonly string[]): Promise<string[]> {
		const keeping = runtime.history();
		if (!keeping?.changedSince || paths.length === 0) return [];
		try {
			return await keeping.changedSince(commit, paths);
		} catch {
			return [];
		}
	}

	/** How far this line is ahead of wherever it is also kept; `0` is a folder
	 *  that is only here. */
	get ahead(): number {
		return this.#ahead;
	}

	/** What has changed since the version the folder stands on; `null` before
	 *  it has been read. */
	get changed(): DifferenceBetween | null {
		return this.#changed;
	}

	/** Whether there is anything at all to keep — the history answers this, and
	 *  {@link changed} names notes and no more. */
	get unkept(): boolean {
		return this.#dirty;
	}

	/** The merge the folder is part-way through, or `null` where it is in the
	 *  middle of nothing. */
	get merging(): MergeUnderway | null {
		return this.#merging;
	}

	/** The notes a merge left in two versions, as the history names them. */
	get inTwoVersions(): readonly string[] {
		return this.#merging?.inTwoVersions ?? [];
	}

	/** What a merge is taking in, as a person reads it: the line standing at that
	 *  version, else its short name. `null` is a folder in the middle of
	 *  nothing. */
	get taking(): string | null {
		const merging = this.#merging;
		if (!merging) return null;
		const at = this.#branches.filter((one) => one.head === merging.taking);
		const line = at.find((one) => one.remote === undefined) ?? at[0];
		return line?.name ?? merging.taking.slice(0, SHORT_NAME);
	}

	/** Whether the folder stands on a version rather than on a line of work.
	 *  Writing while it does is what opens one ({@link HistoryStore.lineHere}). */
	get onAVersion(): boolean {
		return this.#at !== undefined && this.#line === undefined;
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
		this.#dirty = false;
		this.#picture = [];
		this.#drawnCursor = undefined;
		this.#remotes = [];
		this.#places = [];
		this.#behind = 0;
		this.#upstream = undefined;
		this.#elsewhere = null;
		this.#signs = false;
		this.#taken.clear();
		this.#merging = null;
	}

	/** The surface has come up: what an earlier act said no longer stands. */
	/** One version as a surface draws it on the graph: what it is called, and
	 *  the notes as they stood. The one copy, so the column and the surface put
	 *  the same thing on the canvas. */
	async asItWas(commit: string): Promise<{ commit: string; message: string; notes: NodeView[] }> {
		const notes = await this.notesAt(commit);
		const version =
			this.#commits.find((one) => one.id === commit) ??
			this.#picture.find((one) => one.id === commit);
		return { commit, message: version?.message ?? '', notes };
	}

	async opened(): Promise<void> {
		this.#elsewhere = null;
		await this.read();
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
			const [status, page, branches, commit, picture, remotes, signing] = await Promise.all([
				history.status(),
				history.log(PAGE),
				history.branches(),
				history.currentCommit(),
				history.graph?.(PAGE),
				history.remotes?.(),
				history.signing?.()
			]);
			if (at !== this.#epoch) return;
			this.#line = status.branch;
			this.#ahead = status.ahead;
			this.#behind = status.behind;
			this.#upstream = status.upstream;
			this.#dirty = status.changed.length > 0 || status.untracked.length > 0;
			this.#merging = status.merging ?? null;
			this.#commits = page.commits;
			this.#cursor = page.cursor;
			this.#branches = branches;
			this.#at = commit;
			this.#picture = picture?.commits ?? [];
			this.#drawnCursor = picture?.cursor;
			this.#remotes = remotes ?? [];
			this.#signs = signing !== undefined && signing.kind !== 'none';
			const places = await Promise.all(
				(remotes ?? []).map(async (one) => ({ name: one.name, at: await spelled(one) }))
			);
			if (at !== this.#epoch) return;
			this.#places = places;
			const since = await this.between(commit, undefined);
			if (at !== this.#epoch) return;
			this.#changed = since;
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

	/** The page of the picture after the ones already read. */
	async readOlderPicture(): Promise<void> {
		const history = runtime.history();
		const cursor = this.#drawnCursor;
		if (!history?.graph || cursor === undefined) return;
		const at = this.#epoch;
		try {
			const page = await history.graph(PAGE, cursor);
			if (at !== this.#epoch) return;
			this.#picture = [...this.#picture, ...page.commits];
			this.#drawnCursor = page.cursor;
		} catch (err) {
			if (at === this.#epoch) this.#says = said(err);
		}
	}

	/**
	 * Keep what is in the folder as a version. Answers whether anything was
	 * kept: nothing to keep is not a failure.
	 *
	 * **Keeping does not move the folder**, so nothing about the graph is read
	 * again — only what the history itself now says. That is what lets this be
	 * done on a clock (`autosave`) without the graph reloading under somebody's
	 * cursor.
	 */
	async keep(message: string): Promise<boolean> {
		const history = runtime.history();
		if (!history) return false;
		this.#busy = true;
		this.#says = null;
		try {
			const kept = await history.commit(message);
			await this.read();
			return kept !== undefined;
		} catch (err) {
			this.#says = said(err);
			return false;
		} finally {
			this.#busy = false;
		}
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

	/** The folder becomes that version, and is on no line afterwards. */
	async standOn(commit: string, carrying?: boolean): Promise<boolean> {
		return this.act(async (history) => {
			if (!history.standOn) return false;
			await history.standOn(commit, carrying);
			return true;
		});
	}

	/** A line of work where the folder stands, named after the version it starts
	 *  at, with the folder moved onto it. The name it took, and `null` where it
	 *  could not. */
	async lineHere(): Promise<string | null> {
		const at = this.#at;
		if (at === undefined) return null;
		const taken = new Set(this.#branches.map((one) => one.name));
		const from = `from-${at.slice(0, SHORT_NAME)}`;
		let name = from;
		for (let next = 2; taken.has(name); next += 1) name = `${from}-${next}`;
		const done = await this.act(async (history) => {
			if (!history.lineHere) return false;
			await history.lineHere(name);
			return true;
		});
		return done ? name : null;
	}

	/** A line of work called something else. Where the folder is on it, it stays
	 *  on it under the new name. */
	async renameLine(from: string, to: string): Promise<boolean> {
		return this.act(async (history) => {
			if (!history.renameLine) return false;
			await history.renameLine(from, to);
			return true;
		});
	}

	/** Stop the merge the folder is part-way through, leaving it as it was before
	 *  the merge began. */
	async abandonMerge(): Promise<boolean> {
		return this.act(async (history) => {
			if (!history.abandonMerge) return false;
			await history.abandonMerge();
			return true;
		});
	}

	/** Take a line's versions into the one the folder is on. Answers false where
	 *  notes are left in two versions for somebody to settle. */
	async bringIn(name: string): Promise<boolean> {
		return this.act(async (history) => this.tookIn(await history.merge(name)));
	}

	/** A line of work starting at a version further back than the one the folder
	 *  stands on. The folder stays where it is. */
	async startLineAt(name: string, version: string): Promise<boolean> {
		return this.act(async (history) => {
			if (!history.branchAt) return false;
			await history.branchAt(name, version);
			return true;
		});
	}

	/** Let a line of work go. What it kept is still there for as long as
	 *  something else leads back through it. */
	async dropLine(name: string): Promise<boolean> {
		return this.act(async (history) => {
			if (!history.deleteBranch) return false;
			await history.deleteBranch(name);
			return true;
		});
	}

	/** Take what is kept somewhere else, without touching the folder. */
	async lookElsewhere(remote?: string): Promise<boolean> {
		return this.withRemote(
			remote,
			(history, name, credential) => history.fetch?.(name, credential),
			(place, where) => {
				const stood = this.standingAt(where.name);
				if (stood === undefined) return `The lines kept on ${place} are in the list below.`;
				return stood.behind === 0 ? 'Nothing to take.' : waiting(stood.behind);
			}
		);
	}

	/** Take in what is kept somewhere else. Answers false where notes are left
	 *  in two versions for somebody to settle. */
	async takeIn(remote?: string): Promise<boolean> {
		const was = this.#at;
		let settled = true;
		const done = await this.withRemote(
			remote,
			async (history, name, credential) => {
				const result = await history.pull?.(name, credential);
				if (!result) return;
				settled = this.tookIn(result);
			},
			(where) =>
				!settled ? null : this.#at === was ? 'Nothing to take.' : `What is on ${where} is here too.`
		);
		return done && settled;
	}

	/** Put what is here where the folder is also kept. */
	async putElsewhere(remote?: string): Promise<boolean> {
		const where = this.chosen(remote);
		// Nothing but a way in gets a push through, so it is asked for before the
		// act rather than after a refusal nobody can read a next step out of.
		const missing = where === undefined ? undefined : await this.missingWayIn(where.url);
		if (missing !== undefined) {
			this.#elsewhere = { words: missing, refused: true };
			return false;
		}
		return this.withRemote(
			remote,
			(history, name, credential) => history.push?.(name, credential),
			(place) => `Your notes are on ${place}.`
		);
	}

	/** One note in two versions, taken whole from one side. */
	async settle(path: string, side: ConflictSide): Promise<boolean> {
		return this.act(async (history) => {
			await history.resolve(path, side);
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
			// from one side, so anything written before that is written over. A
			// second run after a write refused is not a second thing to settle.
			if (!this.#taken.has(note.path)) {
				await history.resolve(note.path, 'mine');
				this.#taken.add(note.path);
			}
			// Each section goes in after whatever stands in the note by then, so a
			// run of them taken from the other line keeps the order it has there.
			let after: OwnedRef | undefined;
			for (const section of note.sections) {
				const theirs = takeTheirs.has(section.ulid);
				if (theirs && section.theirs && section.mine) {
					const written = await api.updateBlock(section.mine.ref, {
						content: section.theirs.content
					});
					after = written.ref;
				} else if (theirs && section.theirs) {
					const written = await api.createBlock({
						node: note.ref,
						content: section.theirs.content,
						...(after === undefined ? {} : { after })
					});
					after = written.ref;
				} else if (theirs && section.mine) {
					await api.deleteBlock(section.mine.ref);
				} else if (section.mine) {
					after = section.mine.ref;
				}
			}
			this.#taken.delete(note.path);
			return true;
		});
	}

	/** What both sides of the merge have of one note left in two versions. */
	async inTwo(path: string): Promise<NoteInTwoVersions | null> {
		const merging = this.#merging;
		const history = runtime.history();
		if (!merging || !history) return null;
		const { graphAsItWas } = await local();
		const theirs = await graphAsItWas(await history.readAt(merging.taking));
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
	async between(before: StateAsked, after: StateAsked): Promise<DifferenceBetween | null> {
		const history = runtime.history();
		if (!history) return null;
		const { changedBetween } = await local();
		const [was, now] = await Promise.all([this.vaultAt(before), this.vaultAt(after)]);
		if (!was || !now) return null;
		const changed = changedBetween(was, now);
		const went = new Set(
			changed.notes.filter((one) => one.became === 'removed').map((one) => one.ref)
		);
		const gone =
			went.size === 0 ? [] : (await this.notesIn(was)).filter((note) => went.has(note.ref));
		return { ...changed, gone };
	}

	/** Every note a version had, for the canvas and the outline to draw. */
	async notesAt(commit: string): Promise<NodeView[]> {
		const history = runtime.history();
		if (!history) return [];
		return this.notesIn(await history.readAt(commit));
	}

	private async notesIn(folder: FolderAt): Promise<NodeView[]> {
		const { graphAsItWas } = await local();
		const then = await graphAsItWas(folder);
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

	/** Whether a merge settled by itself. */
	private tookIn(result: MergeResult): boolean {
		if (result.merged) return true;
		this.#taken.clear();
		return false;
	}

	/** An act with a place the folder is also kept, the way in this device holds
	 *  for it, and what it did in words. `then` answers `null` where the act has
	 *  already put something else in front of somebody. */
	private async withRemote(
		remote: string | undefined,
		what: (history: History, name: string, credential?: Credential) => Promise<unknown> | undefined,
		then: (place: string, where: Remote) => string | null
	): Promise<boolean> {
		const history = runtime.history();
		if (!history) return false;
		const where = this.chosen(remote);
		if (!where) {
			this.#elsewhere = {
				words: 'Say where else your notes are kept, in Settings, then try again.',
				refused: true
			};
			return false;
		}
		const credential = await this.wayIn(where.url);
		this.#busy = true;
		this.#says = null;
		this.#elsewhere = null;
		try {
			await what(history, where.name, credential);
			// An act moves the folder underneath whatever is serving the graph out
			// of it, so it is served again before anything is read back.
			resetApi();
			await Promise.all([this.read(), readTheGraphAgain()]);
			const words = then(await spelled(where), where);
			this.#elsewhere = words === null ? null : { words, refused: false };
			return true;
		} catch (err) {
			this.#elsewhere = { words: said(err), refused: true };
			return false;
		} finally {
			this.#busy = false;
		}
	}

	/** Which of the places the folder is kept an act with none named is with:
	 *  the one the line follows, else the only one there is. */
	private chosen(remote?: string): Remote | undefined {
		const named = remote ?? this.followsPlace;
		if (named !== undefined) return this.#remotes.find((one) => one.name === named);
		return this.#remotes.length === 1 ? this.#remotes[0] : undefined;
	}

	private async wayIn(url: string): Promise<Credential | undefined> {
		return runtime.credentials()?.forUrl(url);
	}

	/** What to do where this device was never told how to reach that address,
	 *  and nothing where it was or where the address is on this device. */
	private async missingWayIn(url: string): Promise<string | undefined> {
		const { remoteHost } = await local();
		const host = remoteHost(url);
		if (host === undefined) return undefined;
		return (await this.wayIn(url)) === undefined
			? `Add a way in for ${host} in Settings, then try again.`
			: undefined;
	}

	/** An act, with what it refuses in the words it gave, and the surface and the
	 *  graph both read again after it. */
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
			await Promise.all([this.read(), readTheGraphAgain()]);
			return done;
		} catch (err) {
			this.#says = said(err);
			return false;
		} finally {
			this.#busy = false;
		}
	}
}

/**
 * How many versions each of two lines has that the other does not, out of the
 * picture as far as it has been read. `undefined` where a version either line
 * leads back through is older than the page in hand and is not one both of
 * them lead back through, which is a distance this page cannot answer.
 */
function apart(here: string, there: string, drawn: readonly GraphCommit[]): Standing | undefined {
	const springsFrom = new Map(drawn.map((one) => [one.id, one.parents]));
	const MINE = 1;
	const THEIRS = 2;
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to this call and thrown away with it.
	const sides = new Map<string, number>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- as above.
	const unread = new Set<string>();
	const walk: [string, number][] = [
		[here, MINE],
		[there, THEIRS]
	];
	while (walk.length > 0) {
		const step = walk.pop();
		if (step === undefined) continue;
		const [id, side] = step;
		const had = sides.get(id) ?? 0;
		if ((had & side) === side) continue;
		sides.set(id, had | side);
		const parents = springsFrom.get(id);
		if (parents === undefined) {
			unread.add(id);
			continue;
		}
		for (const parent of parents) walk.push([parent, side]);
	}
	for (const id of unread) if (sides.get(id) !== (MINE | THEIRS)) return undefined;
	let ahead = 0;
	let behind = 0;
	for (const side of sides.values()) {
		if (side === MINE) ahead += 1;
		if (side === THEIRS) behind += 1;
	}
	return { ahead, behind };
}

function localPart(ref: OwnedRef): string {
	return ref.slice(ref.lastIndexOf('/') + 1);
}

/** What somebody calls a place their folder is also kept: the host it is at,
 *  and the name they gave it where the address names no host. */
async function spelled(where: Remote): Promise<string> {
	const { remoteHost } = await local();
	return remoteHost(where.url) ?? where.name;
}

function waiting(behind: number): string {
	return behind === 1 ? 'One newer version to take in.' : `${behind} newer versions to take in.`;
}

export const graphHistory = new HistoryStore();
