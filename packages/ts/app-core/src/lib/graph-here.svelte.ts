/**
 * A graph kept on this device, opened in a browser tab —
 * docs/ARCHITECTURE.md § "A graph on this device, in the browser".
 *
 * `LocalApi` serves it, the same one the app for your computer runs, so every
 * page, store and component reaches it through `api` and nothing in it is ever
 * sent anywhere.
 */

import type { OwnedRef } from '@sloppy/types';
import { type Files, holdsAGraph, LocalApi } from '@sloppy/local';
import { api, resetApi } from './api.js';
import { filesFromArchive } from './archive-files.js';
import {
	askForAFolder,
	browserOwnFiles,
	DirectoryFiles,
	filesHere,
	type FolderHandle,
	opensAFolder,
	rememberedFolder,
	rememberFolder,
	stillAllowed
} from './browser-files.js';
import { type DeploymentMode, runtime, updateRuntime } from './runtime.js';
import { seamSettledAgain } from './seam.svelte.js';
import { openHere, saveHere } from './save-file.js';
import { serverMessage } from './stores/errors.js';
import { graphs } from './stores/graphs.svelte.js';
import { letGoOfTheGraphRead } from './stores/let-go.js';
import { session } from './stores/session.svelte.js';

/** Which of the two a person opened, which is what says where their writing
 *  goes: into the folder as they write, or into this tab until they save a
 *  copy of it. */
export type OpenedHow = 'folder' | 'archive';

export interface OpenedHere {
	how: OpenedHow;
	/** What the person calls it — the folder's name, or the file's. */
	name: string;
	/** Whether a note written here carries an identity this browser made for
	 *  itself rather than the account somebody is signed in with. It is what
	 *  the owner block says, and what settles when the graph is opened. */
	ownIdentity: boolean;
}

const NO_FOLDER = 'Sloppy could not open that folder. Try another one.';
/** A tab opens graphs and never starts one, so a folder holding none is the
 *  wrong folder rather than a new graph. */
const NO_GRAPH_THERE = 'That folder holds no graph. Choose the folder your notes are in.';
const NO_GO_AHEAD = 'Sloppy needs your go-ahead to read and write in that folder.';

function said(reason: unknown, fallback: string): string {
	if (typeof reason === 'string' && reason.trim()) return reason;
	const words = serverMessage(reason) ?? (reason instanceof Error ? reason.message : null);
	return words?.trim() ? words : fallback;
}

/** The same files, saying so as anything is written into them. What is written
 *  into an archive is in this tab and nowhere else, so leaving has to ask. */
function watched(files: Files, wrote: () => void): Files {
	return {
		root: files.root,
		read: (path) => files.read(path),
		list: (path) => files.list(path),
		exists: (path) => files.exists(path),
		mkdir: (path) => files.mkdir(path),
		url: (path) => files.url(path),
		pickFolder: (asking) => files.pickFolder(asking),
		dataPath: () => files.dataPath(),
		at: (root) => watched(files.at(root), wrote),
		write: (path, bytes) => {
			wrote();
			return files.write(path, bytes);
		},
		remove: (path) => {
			wrote();
			return files.remove(path);
		}
	};
}

class GraphHereStore {
	#offered = $state(false);
	#open = $state<OpenedHere | null>(null);
	#folder: DirectoryFiles | undefined;
	#settled = $state(false);
	#waiting = $state<FolderHandle | null>(null);
	#guarding = false;
	/** What was serving the app before a graph on this device went in front of
	 *  it, since a shell that is not the hosted one says so itself. */
	#servedMode: DeploymentMode = 'hosted';

	readonly #askBeforeLeaving = (leaving: Event): void => {
		leaving.preventDefault();
	};

	/** Whether this app can open a graph kept on this device at all. The shell
	 *  says so: a webview that already serves one has nothing to offer here. */
	get offered(): boolean {
		return this.#offered;
	}

	/** Whether a folder can be opened, as against an archive alone. */
	get opensAFolder(): boolean {
		return opensAFolder();
	}

	/** The graph on this device in front of somebody, `null` where the one they
	 *  are reading is the Sloppy this app is served from. */
	get open(): OpenedHere | null {
		return this.#open;
	}

	/** Whether the graph a page will read through `api` is settled. A shell
	 *  mounts no page until it is, so nothing asks the Sloppy this app is served
	 *  from about a note kept on this device. */
	get ready(): boolean {
		return this.#settled;
	}

	/** The folder this browser was told to open again and may not read until
	 *  somebody presses something, by the name they know it as. `null` is
	 *  nothing waiting. */
	get waiting(): string | null {
		return this.#waiting?.name ?? null;
	}

	/** Called once by a shell that is served over the network and can open a
	 *  graph kept here beside it. */
	offerHere(): void {
		this.#offered = true;
	}

	/**
	 * The graph this tab is to open, settled before any page reads `api`.
	 * Nobody is asked for anything: a folder this browser may still read opens,
	 * one it must be asked about again waits at the door, and anything else
	 * leaves the Sloppy this app is served from in front of somebody.
	 */
	async boot(): Promise<void> {
		this.#settled = false;
		this.#waiting = null;
		try {
			await this.reopen();
		} finally {
			this.#settled = true;
		}
	}

	/** Ask for a folder and read and write the graph in it from now on. False is
	 *  somebody who named none, which is not a failure. */
	async openFolder(): Promise<boolean> {
		const handle = await askForAFolder();
		if (!handle) return false;
		if (!(await stillAllowed(handle, true).catch(() => false))) throw new Error(NO_GO_AHEAD);
		await this.openHandle(handle);
		await rememberFolder(handle);
		return true;
	}

	/** Open the folder that is waiting, now that somebody has asked for it: a
	 *  browser lets one be asked about again only on a press. */
	async openAgain(): Promise<boolean> {
		const handle = this.#waiting;
		if (!handle) return false;
		if (!(await stillAllowed(handle, true).catch(() => false))) throw new Error(NO_GO_AHEAD);
		await this.openHandle(handle);
		return true;
	}

	/** Leave the folder that is waiting shut and read the Sloppy this app is
	 *  served from. This browser is asked about it again on the next visit. */
	notNow(): void {
		this.#waiting = null;
	}

	/** Ask for an archive and read the graph in it from now on. False is
	 *  somebody who chose no file, which is not a failure. */
	async openArchive(): Promise<boolean> {
		const file = await openHere('.sloppy');
		if (!file) return false;
		const bytes = new Uint8Array(await file.arrayBuffer());
		let files: Files;
		try {
			files = filesFromArchive(bytes);
		} catch (reason) {
			throw new Error(said(reason, "This file isn't a Sloppy graph."), { cause: reason });
		}
		await rememberFolder(null);
		await this.serve(
			{ how: 'archive', name: file.name },
			watched(files, () => this.guard(true))
		);
		return true;
	}

	/** Hand back the graph as an archive again. What is in this tab is what it
	 *  holds. */
	async saveCopy(): Promise<void> {
		const held = await api.exportArchive(graphs.current);
		await saveHere(
			held.filename,
			new Blob([held.bytes.slice().buffer as ArrayBuffer], { type: 'application/zip' })
		);
		this.guard(false);
	}

	/** Put the graph this app is served from back in front of somebody. What is
	 *  in the folder stays in it; what is in an archive is what was saved. */
	async close(): Promise<void> {
		this.guard(false);
		this.#folder?.release();
		this.#folder = undefined;
		updateRuntime({
			mode: () => this.#servedMode,
			createApi: undefined,
			assetSrc: undefined,
			vault: undefined
		});
		resetApi();
		// Who is signed in is asked of the Sloppy this app is served from before
		// anything reads that the graph on this device is gone: a surface told
		// both at once would otherwise read one against the other.
		await session.refresh();
		seamSettledAgain();
		this.#open = null;
		letGoOfTheGraphRead();
		await rememberFolder(null);
		await graphs.load().catch(() => {});
	}

	/** Open the folder this browser was told to open again, where it is still
	 *  allowed to. A folder it must be asked about again waits at the door, and
	 *  one that will not read leaves the Sloppy this app is served from in front
	 *  of somebody. */
	private async reopen(): Promise<void> {
		if (!this.#offered || this.#open) return;
		const handle = await rememberedFolder();
		if (!handle) return;
		if (!(await stillAllowed(handle, false).catch(() => false))) {
			this.#waiting = handle;
			return;
		}
		await this.serveFolder(handle).catch(() => {});
	}

	/** Serve the folder, saying why in words fit to show where it will not. */
	private async openHandle(handle: FolderHandle): Promise<void> {
		try {
			await this.serveFolder(handle);
		} catch (reason) {
			throw new Error(said(reason, NO_FOLDER), { cause: reason });
		}
	}

	/** Whether the browser asks before it leaves the page. What is written into
	 *  an archive lives in this tab until a copy of it is saved. */
	private guard(on: boolean): void {
		if (on === this.#guarding) return;
		this.#guarding = on;
		if (on) window.addEventListener('beforeunload', this.#askBeforeLeaving);
		else window.removeEventListener('beforeunload', this.#askBeforeLeaving);
	}

	private async serveFolder(handle: FolderHandle): Promise<void> {
		const folder = new DirectoryFiles(handle);
		if (!(await holdsAGraph(folder))) throw new Error(NO_GRAPH_THERE);
		await folder.warm();
		await this.serve({ how: 'folder', name: handle.name }, folder);
	}

	private async serve(opened: Pick<OpenedHere, 'how' | 'name'>, files: Files): Promise<void> {
		if (this.#open === null) this.#servedMode = runtime.mode();
		this.#waiting = null;
		if (this.#folder && this.#folder !== files) this.#folder.release();
		this.#folder = files instanceof DirectoryFiles ? files : undefined;
		// Who is signed in here settles before the swap: after it, asking reaches
		// the graph on this device rather than the Sloppy that knows.
		const signedIn = (await session.load().catch(() => null))?.did;
		const served = new LocalApi(
			filesHere(files, browserOwnFiles()),
			signedIn === undefined ? {} : { writer: signedIn }
		);
		updateRuntime({
			mode: () => 'local',
			createApi: () => served,
			// Nothing here is somebody else's, so there is nothing the proxy would
			// be keeping off them.
			assetSrc: (src: string) => src,
			vault: {
				folder: () => this.#open?.name,
				graph: (): Promise<OwnedRef | undefined> => served.graphHere(),
				asks: true,
				alongside: true,
				open: async () => ((await this.openFolder()) ? this.#open?.name : undefined)
			}
		});
		resetApi();
		seamSettledAgain();
		this.#open = { ...opened, ownIdentity: signedIn === undefined };
		letGoOfTheGraphRead();
		// Who is writing here is the graph on this device's answer now.
		await session.refresh();
		try {
			await graphs.load();
		} catch (reason) {
			await this.close();
			throw reason;
		}
		// Opening it is not writing in it: what a person is asked about on the way
		// out is what they wrote after this.
		this.guard(false);
	}
}

export const graphHere = new GraphHereStore();
