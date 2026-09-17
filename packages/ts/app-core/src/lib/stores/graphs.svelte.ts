/**
 * The graphs a person keeps: the one they are in, the ones on the canvas beside
 * it, and the one writer over the API's graph routes.
 *
 * Which graph somebody is in and which they have put up beside it are this
 * device's view choices, so they live in the prefs store — DESIGN.md
 * § Persistence — and are read back through the listing, because a ref saved on
 * this device may belong to somebody who is no longer signed in.
 */

import { MAX_FIELDS } from '@sloppy/graph';
import {
	type ArchivePreview,
	type GraphOwnership,
	type GraphView,
	GraphViewSchema,
	type ImportSettlement,
	type OwnedRef,
	splitOwnedRef,
	type CreateGraphRequest,
	type UpdateGraphRequest
} from '@sloppy/types';
import { api } from '../api.js';
import { type DeviceArea, deviceStore } from '../device-store.js';
import { type KnownFolder, runtime } from '../runtime.js';
import { serverMessage } from './errors.js';
import { nodes } from './nodes.svelte.js';
import { prefs } from './prefs.svelte.js';
import { session } from './session.svelte.js';
import { tags } from './tags.svelte.js';

/** How many graphs may stand on one canvas at once. Past a handful the fields
 *  are further apart than a reader can hold in their head. */
export const MOST_ON_CANVAS = MAX_FIELDS;

/**
 * What a person calls the project a folder holds the notes of, walking the
 * graph's own path to the code from the folder the notes are in. Absent where
 * the graph is nobody's project, and where the path climbs past the top.
 */
export function projectOf(folder: KnownFolder): string | undefined {
	const toTheCode = folder.graph?.project;
	if (toTheCode === undefined) return undefined;
	const at = folder.root.split(/[\\/]/).filter(Boolean);
	for (const step of toTheCode.split(/[\\/]/)) {
		if (step === '' || step === '.') continue;
		if (step !== '..') at.push(step);
		else if (at.pop() === undefined) return undefined;
	}
	return at.at(-1);
}

export interface GraphsState {
	loading: boolean;
	/** True once a load has succeeded; stays true while a reload is in flight. */
	loaded: boolean;
	failed: boolean;
	/** The server's own words, where it gave any. */
	error?: string;
}

const IDLE: GraphsState = { loading: false, loaded: false, failed: false };

const LISTING = 'listing';

function kept(): DeviceArea | null {
	const did = session.viewer?.did;
	return did ? deviceStore.area(did, 'graphs') : null;
}

class GraphsStore {
	#all = $state<GraphView[]>([]);
	#state = $state<GraphsState>(IDLE);
	#inflight: Promise<GraphView[]> | null = null;
	// A {@link clear} that lands mid-request must not be undone by the answer:
	// nothing the previous person's graphs returns belongs to the next one.
	#epoch = 0;
	#restored: Promise<void> | null = null;
	#inFolder = $state<OwnedRef | null>(null);
	#folderRoot = $state<string | undefined>(undefined);
	#openFolder: Promise<void> | null = null;
	#folders = $state<KnownFolder[]>([]);
	#knownFolders: Promise<void> | null = null;
	/** The listing standing is the one this device kept, so an ask that will not
	 *  answer has nothing to report over it. */
	#asLastRead = false;

	/** The one they started with first, which is the order the route answers in. */
	get all(): GraphView[] {
		return this.#all;
	}

	get state(): GraphsState {
		return this.#state;
	}

	/** True once a person has more than one, which is what makes the graph a
	 *  thing to say and to switch between at all. */
	get several(): boolean {
		return this.#all.length > 1;
	}

	/** The graph the reader is in: where a new note goes, and what a surface
	 *  naming none means. */
	get current(): OwnedRef {
		return this.held(prefs.current.graph) ?? this.home;
	}

	/** The graph somebody has before they open a second one — the one the
	 *  listing flags, since every home graph's ulid is its own. Where a graph is
	 *  a folder on this device it is the folder that is open, which is the graph
	 *  in front of somebody there. Empty before the first listing has landed. */
	get home(): OwnedRef {
		if (this.#inFolder) return this.#inFolder;
		const flagged = this.#all.find((graph) => graph.home) ?? this.#all[0];
		return flagged?.ref ?? ('' as OwnedRef);
	}

	/** Every graph on the canvas, the one the reader is in first. */
	get onCanvas(): OwnedRef[] {
		const also = prefs.current.alsoOnCanvas
			.map((ref) => this.held(ref))
			.filter((ref): ref is OwnedRef => ref !== null && ref !== this.current);
		return [this.current, ...new Set(also)].slice(0, MOST_ON_CANVAS);
	}

	/** The graphs on the canvas as the renderer names its fields. */
	get fields(): { ref: OwnedRef; title: string }[] {
		return this.onCanvas.map((ref) => ({ ref, title: this.titleOf(ref) }));
	}

	titleOf(ref: OwnedRef): string {
		return this.#all.find((graph) => graph.ref === ref)?.title ?? '';
	}

	/** Whether a graph in front of this reader is that identity's — the folder
	 *  they have open, or one in the listing. A folder somebody shared holds its
	 *  owner's notes and is read here like any other, so this and not who is
	 *  reading is what says a note is somewhere else. A listing with nothing in
	 *  it knows of nobody, and calls nothing somebody else's. */
	keeps(did: string): boolean {
		const folder = this.#inFolder;
		if (folder !== null && splitOwnedRef(folder).did === did) return true;
		return this.#all.length === 0 || this.#all.some((graph) => graph.created_by === did);
	}

	/**
	 * The listing as this device last held it, so a saved canvas resolves before
	 * — or without — an answer. Idempotent, and never over an answer.
	 */
	restore(): Promise<void> {
		if (this.#restored) return this.#restored;
		const area = kept();
		if (!area) return Promise.resolve();
		const epoch = this.#epoch;
		this.#restored = (async () => {
			const held = await area.get<unknown[]>(LISTING);
			if (!held || epoch !== this.#epoch || this.#state.loaded || this.#all.length > 0) return;
			this.#all = held
				.map((row) => GraphViewSchema.safeParse(row))
				.filter((read) => read.success)
				.map((read) => read.data);
			this.#asLastRead = this.#all.length > 0;
		})().catch(() => {});
		return this.#restored;
	}

	/**
	 * Where a graph is a folder on this device, the graph in the open folder is
	 * the one in front of somebody, so a choice made against another folder is
	 * let go of. Deduped like {@link load}; `again` is a folder that has just
	 * changed. Elsewhere there is no folder and this decides nothing.
	 */
	readOpenFolder(again = false): Promise<void> {
		if (again) this.#openFolder = null;
		this.#openFolder ??= (async () => {
			const vault = runtime.vault();
			if (!vault) return;
			const epoch = this.#epoch;
			const ref = await vault.graph().catch(() => undefined);
			if (epoch !== this.#epoch || ref === undefined) return;
			this.#inFolder = ref;
			this.#folderRoot = vault.folder();
			if (prefs.current.graph !== null && prefs.current.graph !== ref) prefs.set('graph', null);
		})();
		return this.#openFolder;
	}

	/**
	 * The folders this device keeps its graphs in, the one opened most recently
	 * first — every one of them is a graph, and one that is not where it was is
	 * here too. Empty where a graph is not a folder on the device, and the
	 * listing is then the whole answer.
	 */
	get folders(): KnownFolder[] {
		return this.#folders;
	}

	/** The folder in front of somebody, by its root — what says which of the
	 *  folders listed is the one open, since two of them may hold one graph.
	 *  `undefined` where this device keeps no folder. */
	get openFolder(): string | undefined {
		return this.#folderRoot;
	}

	/** Whether this device's graphs are the folders it keeps them in, which is
	 *  what makes the picker the place a folder is opened, started and
	 *  forgotten. */
	get keepsFolders(): boolean {
		return runtime.vault()?.known !== undefined;
	}

	/** Whether a copy of a graph kept somewhere else can be brought onto this
	 *  device at all. */
	get bringsFolders(): boolean {
		return runtime.vault()?.clone !== undefined;
	}

	/** Deduped like {@link load}; `again` is a list that has just changed. */
	readFolders(again = false): Promise<void> {
		if (again) this.#knownFolders = null;
		this.#knownFolders ??= (async () => {
			const known = runtime.vault()?.known;
			if (!known) return;
			const epoch = this.#epoch;
			const listed = await known().catch(() => undefined);
			if (listed && epoch === this.#epoch) this.#folders = listed;
		})();
		return this.#knownFolders;
	}

	/** Serve the graph in one of this device's folders from now on. */
	async enterFolder(root: string): Promise<void> {
		const vault = runtime.vault();
		if (!vault?.openKnown) return;
		await vault.openKnown(root);
		await this.folderChanged();
	}

	/** Whether a project's own folder can be opened as a graph at all. */
	get opensProjects(): boolean {
		return runtime.vault()?.openProject !== undefined;
	}

	/** Open a project somebody names and read the notes kept in it. False is
	 *  somebody who named none, which is not a failure. */
	async openProject(): Promise<boolean> {
		const vault = runtime.vault();
		if (!vault?.openProject) return false;
		if ((await vault.openProject()) === undefined) return false;
		await this.folderChanged();
		return true;
	}

	/** Begin a graph in a folder somebody names. False is somebody who named
	 *  none, which is not a failure. */
	async startFolder(): Promise<boolean> {
		const vault = runtime.vault();
		if (!vault?.start) return false;
		if ((await vault.start()) === undefined) return false;
		await this.folderChanged();
		return true;
	}

	/** Bring a copy of a graph kept somewhere else onto this device, with
	 *  whatever this device was given to reach where it is kept. */
	async cloneFolder(url: string): Promise<boolean> {
		const vault = runtime.vault();
		if (!vault?.clone) return false;
		const credential = await runtime.credentials()?.forUrl(url);
		if ((await vault.clone(url, credential)) === undefined) return false;
		await this.folderChanged();
		return true;
	}

	/** Take a folder off this device's list. Nothing in it is touched, and a
	 *  person opens it again by naming it again. */
	async forgetFolder(root: string): Promise<void> {
		const vault = runtime.vault();
		if (!vault?.forget) return;
		await vault.forget(root);
		await this.readFolders(true);
		await this.reload().catch(() => []);
	}

	/** Two folders may hold one graph, so nothing read out of the last one is a
	 *  copy of anything in this one — however the refs compare. */
	private async folderChanged(): Promise<void> {
		await this.readOpenFolder(true);
		await Promise.all([this.readFolders(true), this.reload().catch(() => [])]);
		await Promise.all([
			nodes.readAgain(),
			...this.onCanvas.map((graph) => tags.reload(graph).catch(() => {}))
		]);
	}

	/** Deduped and idempotent: every surface may call it on mount. */
	load(): Promise<GraphView[]> {
		void this.restore();
		void this.readOpenFolder();
		void this.readFolders();
		if (this.#inflight) return this.#inflight;
		if (this.#state.loaded) return Promise.resolve(this.#all);
		return this.reload();
	}

	reload(): Promise<GraphView[]> {
		if (this.#inflight) return this.#inflight;
		const epoch = this.#epoch;
		const current = () => epoch === this.#epoch;
		const before = this.#state;
		this.#state = { ...before, loading: true, failed: false, error: undefined };
		const request = api
			.listGraphs()
			.then((list) => {
				if (!current()) return [];
				this.#all = list;
				this.#asLastRead = false;
				this.#state = { loading: false, loaded: true, failed: false };
				this.#keep();
				return list;
			})
			.catch(async (err: unknown) => {
				// Offline an ask can fail before the device has answered, and a
				// listing this device kept is not something to report a failure over.
				await this.restore();
				if (current()) {
					this.#state = this.#asLastRead
						? { loading: false, loaded: before.loaded, failed: false }
						: {
								loading: false,
								loaded: before.loaded,
								failed: true,
								error: serverMessage(err)
							};
				}
				throw err;
			})
			.finally(() => {
				if (current()) this.#inflight = null;
			});
		this.#inflight = request;
		return request;
	}

	/** A new graph, which the reader is then in. */
	async open(request: CreateGraphRequest): Promise<GraphView> {
		const epoch = this.#epoch;
		const made = await api.createGraph(request);
		if (epoch !== this.#epoch) return made;
		this.#all = [...this.#all, made];
		this.#keep();
		this.enter(made.ref);
		return made;
	}

	exportArchive(ref: OwnedRef): Promise<{ bytes: Uint8Array; filename: string }> {
		return api.exportArchive(ref);
	}

	/** What that file holds, with none of it written. */
	previewImport(archive: Blob): Promise<ArchivePreview> {
		return api.previewArchive(archive);
	}

	/** Bring the graph in, and be in it. One replacing a graph already kept
	 *  takes its place in the listing rather than standing beside it.
	 *  `settle` is what the person chose where the two copies of one graph
	 *  disagreed; absent is an import with nothing to settle. */
	async importArchive(archive: Blob, settle?: ImportSettlement): Promise<GraphView> {
		const epoch = this.#epoch;
		const brought = await api.importArchive(archive, settle);
		if (epoch !== this.#epoch) return brought;
		this.#all = this.#all.some((graph) => graph.ref === brought.ref)
			? this.#all.map((graph) => (graph.ref === brought.ref ? brought : graph))
			: [...this.#all, brought];
		this.#keep();
		this.enter(brought.ref);
		return brought;
	}

	async rename(ref: OwnedRef, request: UpdateGraphRequest): Promise<GraphView> {
		const epoch = this.#epoch;
		const named = await api.updateGraph(ref, request);
		if (epoch === this.#epoch) {
			this.#all = this.#all.map((graph) => (graph.ref === ref ? named : graph));
			this.#keep();
		}
		return named;
	}

	/** What a graph does to a note written in it from here on; the notes already
	 *  written in it are left as they are. The graph's own name goes beside it
	 *  because naming a graph is the whole of `UpdateGraphRequest`, so a graph
	 *  this store no longer holds is refused rather than named by a guess. */
	async setOwnership(ref: OwnedRef, ownership: GraphOwnership): Promise<GraphView> {
		const held = this.#all.find((graph) => graph.ref === ref);
		if (!held) throw new Error('That graph is not here any more. Open your graphs again.');
		return await this.rename(ref, { title: held.title, ownership });
	}

	/** Close a graph and everything filed in it. A reader who was in it is back
	 *  in the one they started with, and it comes off the canvas. */
	async close(ref: OwnedRef): Promise<void> {
		const epoch = this.#epoch;
		await api.closeGraph(ref);
		if (epoch !== this.#epoch) return;
		this.#all = this.#all.filter((graph) => graph.ref !== ref);
		this.#keep();
		if (prefs.current.graph === ref) prefs.set('graph', null);
		prefs.set(
			'alsoOnCanvas',
			prefs.current.alsoOnCanvas.filter((also) => also !== ref)
		);
		// A graph that was a folder took the folder off this device's list with it.
		await this.readFolders(true);
	}

	/** Move into a graph. One that was standing beside the graph being read
	 *  trades places with it: it becomes the one you are in, and the one you
	 *  were in comes down off the canvas. */
	enter(ref: OwnedRef): void {
		prefs.set('graph', ref);
		prefs.set(
			'alsoOnCanvas',
			prefs.current.alsoOnCanvas.filter((also) => also !== ref)
		);
	}

	/** Put another graph up beside the one being read, or take it back down. The
	 *  graph the reader is IN is never one of these — it is always on the canvas. */
	toggleOnCanvas(ref: OwnedRef): void {
		if (ref === this.current) return;
		const held = prefs.current.alsoOnCanvas;
		prefs.set(
			'alsoOnCanvas',
			held.includes(ref)
				? held.filter((also) => also !== ref)
				: [...held, ref].slice(-(MOST_ON_CANVAS - 1))
		);
	}

	/** True where a full canvas is what stops another graph going up. */
	get canvasFull(): boolean {
		return this.onCanvas.length >= MOST_ON_CANVAS;
	}

	/** After a sign-out or an erase: nothing cached belongs to the next person,
	 *  and a saved graph choice names the identity that kept it. */
	clear(): void {
		this.#epoch++;
		this.#all = [];
		this.#state = IDLE;
		this.#inflight = null;
		this.#restored = null;
		this.#inFolder = null;
		this.#folderRoot = undefined;
		this.#openFolder = null;
		this.#folders = [];
		this.#knownFolders = null;
		this.#asLastRead = false;
		prefs.set('graph', null);
		prefs.set('alsoOnCanvas', []);
	}

	#keep(): void {
		const area = kept();
		if (!area) return;
		void area.set(LISTING, $state.snapshot(this.#all)).catch(() => {});
	}

	/** A ref this person actually keeps, or `null`. A saved choice outlives the
	 *  person who made it, and a graph is one identity's. */
	private held(ref: OwnedRef | null): OwnedRef | null {
		if (ref === null) return null;
		if (ref === this.home) return ref;
		return this.#all.some((graph) => graph.ref === ref) ? ref : null;
	}
}

export const graphs = new GraphsStore();
