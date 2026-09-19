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

function said(reason: unknown, fallback: string): string {
	if (typeof reason === 'string' && reason.trim()) return reason;
	const words = serverMessage(reason) ?? (reason instanceof Error ? reason.message : null);
	return words?.trim() ? words : fallback;
}

class GraphHereStore {
	#offered = $state(false);
	#open = $state<OpenedHere | null>(null);
	#folder: DirectoryFiles | undefined;
	/** What was serving the app before a graph on this device went in front of
	 *  it, since a shell that is not the hosted one says so itself. */
	#servedMode: DeploymentMode = 'hosted';

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

	/** Called once by a shell that is served over the network and can open a
	 *  graph kept here beside it. */
	offerHere(): void {
		this.#offered = true;
	}

	/** Open the folder this browser was told to open again, where it is still
	 *  allowed to. False is every other case, which is the ordinary first
	 *  visit — nobody is asked for anything on a launch. */
	async reopen(): Promise<boolean> {
		if (!this.#offered || this.#open) return false;
		const handle = await rememberedFolder();
		if (!handle || !(await stillAllowed(handle, false).catch(() => false))) return false;
		await this.serveFolder(handle);
		return true;
	}

	/** Ask for a folder and read and write the graph in it from now on. False is
	 *  somebody who named none, which is not a failure. */
	async openFolder(): Promise<boolean> {
		const handle = await askForAFolder();
		if (!handle) return false;
		if (!(await stillAllowed(handle, true).catch(() => false))) {
			throw new Error('Sloppy needs your go-ahead to read and write in that folder.');
		}
		try {
			await this.serveFolder(handle);
		} catch (reason) {
			throw new Error(said(reason, NO_FOLDER), { cause: reason });
		}
		await rememberFolder(handle);
		return true;
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
		await this.serve({ how: 'archive', name: file.name }, files);
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
	}

	/** Put the graph this app is served from back in front of somebody. What is
	 *  in the folder stays in it; what is in an archive is what was saved. */
	async close(): Promise<void> {
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

	private async serveFolder(handle: FolderHandle): Promise<void> {
		const folder = new DirectoryFiles(handle);
		if (!(await holdsAGraph(folder))) throw new Error(NO_GRAPH_THERE);
		await folder.warm();
		await this.serve({ how: 'folder', name: handle.name }, folder);
	}

	private async serve(opened: Pick<OpenedHere, 'how' | 'name'>, files: Files): Promise<void> {
		if (this.#open === null) this.#servedMode = runtime.mode();
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
	}
}

export const graphHere = new GraphHereStore();
