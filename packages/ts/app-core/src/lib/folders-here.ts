/**
 * A folder kept on this device, as the shell around the app reaches one. A
 * browser tab's own is {@link browserFolders}; a shell inside a native process
 * hands `graphHere.offerHere` one of its own, so one store serves the folder
 * either way — docs/ARCHITECTURE.md § "A graph on this device, beside the one a Sloppy serves".
 */

import type { Files } from '@sloppy/local';
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

/** One folder, as the shell holds it. */
export interface FolderHere {
	/** What the person calls it, which is what a surface shows. */
	readonly name: string;
	/**
	 * Whether the app may read and write in it. `ask` is a person who just
	 * pressed something, which is the only moment a browser lets one be asked —
	 * false on a launch, so nobody is asked for anything they did not begin.
	 */
	allowed(ask: boolean): Promise<boolean>;
	/** The graph's files, read and written in place. `dataPath` on them reaches
	 *  this device's own corner rather than the folder, because a private key
	 *  does not belong in somebody's notes. */
	open(): Promise<Files>;
	/** Open this one again on the next launch rather than asking. */
	remember(): Promise<void>;
	/** Give up whatever was held while it was open. */
	release(): void;
}

/** How a shell reaches the folders on the device it runs on. */
export interface FoldersHere {
	/** Whether a folder can be opened at all, as against an archive alone. */
	readonly opens: boolean;
	/** Whether a folder holding no graph has one started in it. False is a
	 *  browser tab, where a folder holding none is the wrong folder rather than
	 *  a new graph. */
	readonly starts: boolean;
	/** Ask somebody for a folder. `undefined` is somebody who named none, which
	 *  is not a failure. */
	ask(): Promise<FolderHere | undefined>;
	/** The folder this shell was told to open again, `undefined` before it has
	 *  been told anything — the first visit, and a shell that keeps nothing
	 *  between them. */
	remembered(): Promise<FolderHere | undefined>;
	/** Ask for a folder on the next launch rather than opening one again. */
	forget(): Promise<void>;
}

class FolderInThisBrowser implements FolderHere {
	#files: DirectoryFiles | undefined;

	constructor(private readonly handle: FolderHandle) {}

	get name(): string {
		return this.handle.name;
	}

	allowed(ask: boolean): Promise<boolean> {
		return stillAllowed(this.handle, ask);
	}

	async open(): Promise<Files> {
		const folder = new DirectoryFiles(this.handle);
		this.#files = folder;
		await folder.warm();
		return filesHere(folder, browserOwnFiles());
	}

	remember(): Promise<void> {
		return rememberFolder(this.handle);
	}

	release(): void {
		this.#files?.release();
		this.#files = undefined;
	}
}

/** The folders a browser tab reaches: one somebody picks, and the one this
 *  browser was told to ask for again. */
export function browserFolders(): FoldersHere {
	return {
		get opens(): boolean {
			return opensAFolder();
		},
		starts: false,
		ask: async () => {
			const handle = await askForAFolder();
			return handle === undefined ? undefined : new FolderInThisBrowser(handle);
		},
		remembered: async () => {
			const handle = await rememberedFolder();
			return handle === undefined ? undefined : new FolderInThisBrowser(handle);
		},
		forget: () => rememberFolder(null)
	};
}
