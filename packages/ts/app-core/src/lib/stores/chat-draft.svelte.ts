/**
 * The draft a chat works in: a copy of the folder every act lands in, standing
 * apart from the one in front of somebody until they take it in or throw it
 * away — docs/ARCHITECTURE.md § "Asking a tool to write the notes".
 *
 * `DraftAccess` in `runtime.ts` is the platform's half — making the copy and
 * reaching it. Reading two copies of one graph against each other and settling
 * them is the store's, and it is `previewVault` and `importVault` in
 * `@sloppy/local`, so a draft comes in by exactly the rule an archive of the
 * same graph comes in by.
 */

import {
	graphAsItIs,
	graphAsItWas,
	previewArrivingVault,
	settleArrivingVault,
	type Files,
	type GraphAsItWas,
	type History
} from '@sloppy/local';
import type {
	BlockView,
	ImportConflict,
	ImportSettlement,
	NodeView,
	OwnedRef,
	StandingDraft
} from '@sloppy/types';
import {
	countsIn,
	noDifference,
	vaultDifference,
	type DifferenceCounts,
	type Vault,
	type VaultDifference
} from '@sloppy/vault';
import { api } from '../api.js';
import type { DraftNote } from '../draft-said.js';
import { runtime } from '../runtime.js';
import { seam } from '../seam.svelte.js';
import { wordsFor } from './errors.js';
import { graphs } from './graphs.svelte.js';
import { troubleIn, whatHappened } from './what-happened.svelte.js';

/** What a turn's writing is kept as on the draft, where a person reads their
 *  own versions back. */
const KEPT_ON_DRAFT = 'What the chat wrote';

/** And what taking a draft in is kept as in their folder. */
const KEPT_ON_MERGE = 'A draft taken in';

const UNREAD = 'Sloppy could not read the draft just now. Try again.';
const UNMERGED = 'That draft could not be taken in just now. Try again.';
const UNDISCARDED = 'That draft could not be thrown away just now. Try again.';

/** What a review reads: what the draft says differently, what has to be
 *  settled before any of it lands, and every note either copy can name. */
export interface DraftAsRead {
	difference: VaultDifference;
	conflicts: readonly ImportConflict[];
	named: ReadonlyMap<OwnedRef, DraftNote>;
	/** Whether the draft is a copy of the folder with nothing done to it. A
	 *  draft that changed what `difference` does not enumerate — a note's tags,
	 *  its links, how it or a line out of it is drawn — is not nothing, and
	 *  merging takes it in. */
	nothing: boolean;
	/** Every note the draft holds, which is the later of the two states the
	 *  canvas draws. */
	drafted: readonly NodeView[];
	/** The notes the folder holds and the draft does not, as the folder has
	 *  them: a note that went can only be drawn where it was if the canvas is
	 *  handed it. */
	gone: readonly NodeView[];
	/** The version of the draft all of this was read at. */
	at: string;
}

/** Which copy of a note somebody is reading: the draft's, or the one their own
 *  folder holds beside it. */
export type DraftSide = 'draft' | 'folder';

/** One note as one copy has it, with the pictures inside it. */
export interface DraftedNote {
	note: NodeView;
	sections: readonly BlockView[];
	picture(uploadId: string): Promise<{ src: string; release: () => void }>;
}

/** The two copies to settle between, the state the draft was taken from —
 *  which is what says whether a note the draft does not hold went in its bin —
 *  and the version of the draft they were read at. */
interface TwoCopies {
	mine: Vault;
	theirs: Vault;
	from: Vault;
	at: string;
	/** Whether anything has been written into the draft since it was taken. */
	wrote: boolean;
}

class ChatDraftStore {
	#standing = $state.raw<StandingDraft | null>(null);
	#counts = $state.raw<DifferenceCounts | null>(null);
	#read = $state.raw<DraftAsRead | null>(null);
	#wrote = $state(false);
	#reading = $state(false);
	#busy = $state(false);
	#says = $state.raw<string | null>(null);
	/** One start at a time: the agent calls several acts at once and each one
	 *  wants the draft, and two starts would be two copies of one folder. */
	#starting: Promise<StandingDraft> | null = null;
	/** The two copies of the graph, for reading one note as each has it.
	 *  Nothing watches them: a row asks a question and draws the answer. */
	#copies: Record<DraftSide, GraphAsItWas | null> = { draft: null, folder: null };

	/** Whether this device keeps drafts at all. Absent is a shell that does
	 *  not, where a chat writes into the project itself. */
	get keeps(): boolean {
		return this.#access() !== undefined;
	}

	/** The draft standing for the folder in front of somebody. */
	get standing(): StandingDraft | null {
		return this.#standing;
	}

	/** How much is in it, for a line saying so before anybody reads it. Null
	 *  until it has been counted. */
	get counts(): DifferenceCounts | null {
		return this.#counts;
	}

	/** What the review lists, once it has been read. */
	get read(): DraftAsRead | null {
		return this.#read;
	}

	/** Whether the chat has written into the standing draft at all. What
	 *  {@link counts} counts is a part of that and not the whole of it. */
	get wrote(): boolean {
		return this.#wrote;
	}

	get reading(): boolean {
		return this.#reading;
	}

	/** Whether taking it in or throwing it away is underway. */
	get busy(): boolean {
		return this.#busy;
	}

	/** What went wrong, in words meant for the person. */
	get says(): string | null {
		return this.#says;
	}

	/** Look for a draft left standing — by an earlier turn, or by an earlier
	 *  run of the app. Not finding one is not a failure. */
	async look(): Promise<void> {
		const drafts = this.#access();
		if (!drafts) return;
		try {
			this.#standing = (await drafts.standing()) ?? null;
		} catch (error) {
			this.#standing = null;
			whatHappened.put('trouble', `the draft was not looked up: ${troubleIn(error)}`);
		}
		if (this.#standing) {
			await this.count();
			return;
		}
		this.#counts = null;
		this.#wrote = false;
	}

	/** The draft to work in: the one standing, or a new one holding the notes
	 *  as the folder has them now. REJECTS in words for the person. */
	async start(): Promise<StandingDraft> {
		const drafts = this.#access();
		if (!drafts) throw new Error('There is no draft of the notes to write into.');
		this.#starting ??= drafts.start().finally(() => {
			this.#starting = null;
		});
		const draft = await this.#starting;
		this.#standing = draft;
		return draft;
	}

	/** The draft's copy of the project, which is what a chat's acts are served
	 *  against. Absent while none stands. */
	files(): Files | undefined {
		const drafts = this.#access();
		const draft = this.#standing;
		return drafts && draft ? drafts.files(draft) : undefined;
	}

	/**
	 * A version kept on the draft, and what it holds counted again — what a
	 * turn ending leaves behind. Nothing in a draft is on anybody's canvas, so
	 * this is the whole of it.
	 */
	async keepWhatTheTurnWrote(): Promise<void> {
		const history = this.#history();
		if (!history) return;
		try {
			await history.commit(KEPT_ON_DRAFT);
		} catch (error) {
			whatHappened.put('trouble', `the draft kept no version: ${troubleIn(error)}`);
		}
		await this.count();
	}

	/** How much the draft holds, read again. */
	async count(): Promise<void> {
		try {
			const copies = await this.#twoCopies();
			this.#counts = copies === null ? null : countsIn(vaultDifference(copies.mine, copies.theirs));
			this.#wrote = copies?.wrote ?? false;
		} catch (error) {
			this.#counts = null;
			this.#wrote = false;
			whatHappened.put('trouble', `the draft was not counted: ${troubleIn(error)}`);
		}
	}

	/**
	 * The whole review: every note the draft says something different about,
	 * and what has to be settled first. The folder in front of somebody is not
	 * moved to read it — the draft's own versions answer.
	 */
	async review(): Promise<void> {
		this.#reading = true;
		this.#says = null;
		try {
			const copies = await this.#twoCopies();
			if (copies === null) {
				this.#read = null;
				this.#wrote = false;
				return;
			}
			const difference = vaultDifference(copies.mine, copies.theirs);
			const [preview, drafted, held] = await Promise.all([
				previewArrivingVault(api, { vault: copies.theirs, from: copies.from }),
				graphAsItWas(copies.theirs),
				graphAsItWas(copies.mine)
			]);
			const [there, here] = await Promise.all([notesIn(drafted), notesIn(held)]);
			const inTheFolder = new Map(here.map((note) => [note.ref, note]));
			this.#copies = { draft: drafted, folder: held };
			this.#counts = countsIn(difference);
			this.#wrote = copies.wrote;
			this.#read = {
				difference,
				conflicts: preview.conflicts,
				named: new Map([...cited(here), ...cited(there)]),
				nothing: noDifference(difference) && !copies.wrote,
				drafted: there,
				gone: difference.notes.removed.flatMap((ref) => {
					const note = inTheFolder.get(ref);
					return note ? [note] : [];
				}),
				at: copies.at
			};
		} catch (error) {
			this.#read = null;
			this.#says = wordsFor(error) ?? UNREAD;
		} finally {
			this.#reading = false;
		}
	}

	/** One note as one of the two copies has it. `null` is a copy that does not
	 *  hold it — in the draft, a note it put in the bin. */
	async asRead(side: DraftSide, note: OwnedRef): Promise<DraftedNote | null> {
		const copy = this.#copies[side];
		if (!copy) return null;
		const held = await copy.getNode(note).catch(() => null);
		if (!held) return null;
		const sections = await copy.listBlocks(note).catch(() => [] as BlockView[]);
		return { note: held, sections, picture: (uploadId) => copy.ownPicture(uploadId) };
	}

	/**
	 * The draft taken in: settled into the folder note by note and section by
	 * section, kept as a version there, and then gone. `settle` is what the
	 * person chose where the two copies disagreed.
	 */
	async merge(settle?: ImportSettlement): Promise<boolean> {
		if (this.#busy) return false;
		this.#busy = true;
		this.#says = null;
		try {
			const copies = await this.#twoCopies();
			if (copies === null) throw new Error(UNMERGED);
			await settleArrivingVault(api, { vault: copies.theirs, from: copies.from }, settle);
			await runtime.history()?.commit(KEPT_ON_MERGE);
			await this.#letGo();
			await graphs.readFolderAgain();
			return true;
		} catch (error) {
			this.#says = wordsFor(error) ?? UNMERGED;
			return false;
		} finally {
			this.#busy = false;
		}
	}

	/** The draft thrown away, with nothing of it left behind. */
	async discard(): Promise<boolean> {
		if (this.#busy) return false;
		this.#busy = true;
		this.#says = null;
		try {
			await this.#letGo();
			return true;
		} catch (error) {
			this.#says = wordsFor(error) ?? UNDISCARDED;
			return false;
		} finally {
			this.#busy = false;
		}
	}

	/** Another graph has not had this one's draft. The draft on the disk is
	 *  left exactly where it is: only what was read of it is let go. */
	clear(): void {
		this.#standing = null;
		this.#counts = null;
		this.#wrote = false;
		this.#read = null;
		this.#copies = { draft: null, folder: null };
		this.#says = null;
		this.#reading = false;
		this.#busy = false;
	}

	#access() {
		return seam().chat()?.drafts;
	}

	#history(): History | undefined {
		const drafts = this.#access();
		const draft = this.#standing;
		return drafts && draft ? drafts.history(draft) : undefined;
	}

	async #letGo(): Promise<void> {
		const drafts = this.#access();
		const draft = this.#standing;
		if (drafts && draft) await drafts.discard(draft);
		this.#standing = null;
		this.#counts = null;
		this.#wrote = false;
		this.#read = null;
		this.#copies = { draft: null, folder: null };
	}

	async #twoCopies(): Promise<TwoCopies | null> {
		const history = this.#history();
		const draft = this.#standing;
		if (!history || !draft) return null;
		const tip = await history.currentCommit();
		if (tip === undefined) return null;
		const [mine, theirs, from] = await Promise.all([
			graphAsItIs(api),
			history.readAt(tip),
			history.readAt(draft.from)
		]);
		return { mine, theirs, from, at: tip, wrote: tip !== draft.from };
	}
}

/** Every note one copy of a graph holds, once each: a branch is listed both as
 *  the graph's and as its own root. */
async function notesIn(copy: GraphAsItWas): Promise<NodeView[]> {
	const graph = await copy.graphHere();
	const roots = await copy.listNodes({ graph });
	const under = await Promise.all(roots.map((root) => copy.listNodes({ origin: root.ref })));
	return [...new Map([...roots, ...under.flat()].map((note) => [note.ref, note])).values()];
}

/** The same notes as somebody cites them. */
function cited(notes: readonly NodeView[]): [OwnedRef, DraftNote][] {
	return notes.map((note) => [
		note.ref,
		{ title: note.title, ...(note.address === undefined ? {} : { address: note.address }) }
	]);
}

export const chatDraft = new ChatDraftStore();
