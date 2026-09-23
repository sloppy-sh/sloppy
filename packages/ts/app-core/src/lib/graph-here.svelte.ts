/**
 * A graph kept on this device, put in front of somebody beside the Sloppy their
 * app is served from — docs/ARCHITECTURE.md § "A graph on this device, beside
 * the one a Sloppy serves".
 *
 * `LocalApi` serves it, the same one the app for your computer runs, so every
 * page, store and component reaches it through `api` and nothing in it is ever
 * sent anywhere.
 */

import type { OwnedRef } from '@sloppy/types';
import { type Files, holdsAGraph, LocalApi } from '@sloppy/local';
import { Refusal } from '@sloppy/ui';
import { api, resetApi } from './api.js';
import { filesFromArchive } from './archive-files.js';
import { browserOwnFiles, filesHere } from './browser-files.js';
import { browserFolders, type FolderHere, type FoldersHere } from './folders-here.js';
import { type DeploymentMode, runtime, updateRuntime } from './runtime.js';
import { seamSettledAgain } from './seam.svelte.js';
import { openHere, saveHere } from './save-file.js';
import { refusal } from './stores/errors.js';
import { graphs } from './stores/graphs.svelte.js';
import { letGoOfTheGraphRead } from './stores/let-go.js';
import { session } from './stores/session.svelte.js';

export type { FolderHere, FoldersHere } from './folders-here.js';

/** Which of the two a person opened, which is what says where their writing
 *  goes: into the folder as they write, or into Sloppy until they save a copy
 *  of it. */
export type OpenedHow = 'folder' | 'archive';

export interface OpenedHere {
	how: OpenedHow;
	/** What the person calls it — the folder's name, or the file's. */
	name: string;
	/** Whether a note written here carries an identity made here rather than the
	 *  account somebody is signed in with. It is what the owner block says, and
	 *  what settles when the graph is opened. */
	ownIdentity: boolean;
}

const NO_FOLDER = 'Sloppy could not open that folder. Try another one.';
const NO_GRAPH_THERE = 'That folder holds no graph. Choose the folder your notes are in.';
const NO_GO_AHEAD = 'Sloppy needs your go-ahead to read and write in that folder.';

/** The same files, saying so as anything is written into them. What is written
 *  into an archive is in Sloppy and nowhere else, so leaving has to ask. */
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
	#folders: FoldersHere = browserFolders();
	#serving: FolderHere | undefined;
	#settled = $state(false);
	#waiting = $state<FolderHere | null>(null);
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
		return this.#folders.opens;
	}

	/** Whether a folder holding no graph has one started in it, which is what
	 *  the offer of a folder says. */
	get startsAGraph(): boolean {
		return this.#folders.starts;
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

	/** The folder this shell was told to open again and may not read until
	 *  somebody presses something, by the name they know it as. `null` is
	 *  nothing waiting. */
	get waiting(): string | null {
		return this.#waiting?.name ?? null;
	}

	/** Called once by a shell that is served over the network and can open a
	 *  graph kept here beside it. `folders` is how that shell reaches one; left
	 *  out is a browser tab, which asks its own browser. */
	offerHere(folders: FoldersHere = browserFolders()): void {
		this.#offered = true;
		this.#folders = folders;
	}

	/**
	 * The graph to open here, settled before any page reads `api`. Nobody is
	 * asked for anything: a folder this shell may still read opens, one it must
	 * be asked about again waits at the door, and anything else leaves the
	 * Sloppy this app is served from in front of somebody.
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
		const folder = await this.#folders.ask();
		if (!folder) return false;
		await this.openOne(folder);
		await folder.remember();
		return true;
	}

	/** Open the folder that is waiting, now that somebody has asked for it: a
	 *  browser lets one be asked about again only on a press. */
	async openAgain(): Promise<boolean> {
		const folder = this.#waiting;
		if (!folder) return false;
		await this.openOne(folder);
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
			throw refusal(reason, "This file isn't a Sloppy graph.");
		}
		await this.#folders.forget();
		await this.serve(
			{ how: 'archive', name: file.name },
			filesHere(
				watched(files, () => this.guard(true)),
				browserOwnFiles()
			)
		);
		return true;
	}

	/** Hand back the graph as an archive again. What is open here is what it
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
		this.#serving?.release();
		this.#serving = undefined;
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
		await this.#folders.forget();
		await graphs.load().catch(() => {});
	}

	/** Open the folder this shell was told to open again, where it is still
	 *  allowed to. A folder it must be asked about again waits at the door, and
	 *  one that will not read leaves the Sloppy this app is served from in front
	 *  of somebody. */
	private async reopen(): Promise<void> {
		if (!this.#offered || this.#open) return;
		const folder = await this.#folders.remembered();
		if (!folder) return;
		if (!(await folder.allowed(false).catch(() => false))) {
			this.#waiting = folder;
			return;
		}
		await this.serveFolder(folder).catch(() => {});
	}

	/** Serve the folder somebody just pressed for, saying why in words fit to
	 *  show where it will not. */
	private async openOne(folder: FolderHere): Promise<void> {
		if (!(await folder.allowed(true).catch(() => false))) throw new Refusal(NO_GO_AHEAD);
		try {
			await this.serveFolder(folder);
		} catch (reason) {
			throw refusal(reason, NO_FOLDER);
		}
	}

	/** Whether the browser asks before it leaves the page. What is written into
	 *  an archive lives in Sloppy until a copy of it is saved. */
	private guard(on: boolean): void {
		if (on === this.#guarding) return;
		this.#guarding = on;
		if (on) window.addEventListener('beforeunload', this.#askBeforeLeaving);
		else window.removeEventListener('beforeunload', this.#askBeforeLeaving);
	}

	private async serveFolder(folder: FolderHere): Promise<void> {
		const files = await folder.open();
		if (!this.#folders.starts && !(await holdsAGraph(files))) {
			folder.release();
			throw new Refusal(NO_GRAPH_THERE);
		}
		await this.serve({ how: 'folder', name: folder.name }, files, folder);
	}

	private async serve(
		opened: Pick<OpenedHere, 'how' | 'name'>,
		files: Files,
		folder?: FolderHere
	): Promise<void> {
		if (this.#open === null) this.#servedMode = runtime.mode();
		if (this.#serving && this.#serving !== folder) this.#serving.release();
		this.#serving = folder;
		// Who is signed in here settles before the swap: after it, asking reaches
		// the graph on this device rather than the Sloppy that knows.
		const signedIn = (await session.load().catch(() => null))?.did;
		const served = new LocalApi(files, signedIn === undefined ? {} : { writer: signedIn });
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
		// The door comes down only once the graph on this device answers, so no
		// page reads the hosted Sloppy about a note kept here.
		this.#waiting = null;
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
