/**
 * The folders on this device, as a build that talks to a server reaches one.
 * `graphHere` in `@sloppy/app-core` serves whichever of them somebody opens,
 * the same swap a browser tab makes — docs/ARCHITECTURE.md § "A graph on this
 * device, in the browser".
 */

import type { FolderHere, FoldersHere } from '@sloppy/app-core/graph-here';
import { holdsAGraph, type Files } from '@sloppy/local';
import { tauriFiles } from './files';
import { forgetOpenVault, openedFolder, rememberedVault, rememberVault } from './local-mode';

class FolderOnThisDevice implements FolderHere {
	constructor(
		private readonly device: Files,
		/** Where it is, which is what this device calls a folder everywhere. */
		readonly name: string
	) {}

	async allowed(): Promise<boolean> {
		return true;
	}

	async open(): Promise<Files> {
		return this.device.at(this.name);
	}

	async remember(): Promise<void> {
		await rememberVault(this.device, this.name);
		await openedFolder(this.device, this.name);
	}

	release(): void {}
}

export function deviceFolders(device: Files = tauriFiles()): FoldersHere {
	return {
		opens: true,
		starts: true,
		ask: async () => {
			const root = await device.pickFolder();
			return root === undefined ? undefined : new FolderOnThisDevice(device, root);
		},
		remembered: async () => {
			const root = await rememberedVault(device);
			if (root === undefined) return undefined;
			// A folder that has been moved or emptied since is not one to start a
			// graph in on a launch nobody asked for.
			if (!(await holdsAGraph(device.at(root)).catch(() => false))) return undefined;
			return new FolderOnThisDevice(device, root);
		},
		forget: () => forgetOpenVault(device)
	};
}
