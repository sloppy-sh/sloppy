/**
 * Whether this build opens a graph as a folder on the device, and which folder
 * it opened last — docs/ARCHITECTURE.md § "Local-only mode".
 */

import type { KnownFolder } from '@sloppy/app-core';
import {
	CONTAINER_DIR,
	containerOf,
	forgetVault,
	holdsAGraph,
	readVaults,
	vaultOpened,
	type Files
} from '@sloppy/local';
import { GRAPH_FILE, readGraphFile } from '@sloppy/vault';

/**
 * `scripts/tauri.sh` is the only writer of PUBLIC_ENABLE_LOCAL_MODE, so anything
 * else — unset included — is a build that talks to a server.
 *
 * Read through `import.meta.env` rather than `$env/static/public`, which throws
 * when the variable is unset.
 */
export const LOCAL_MODE: boolean = import.meta.env.PUBLIC_ENABLE_LOCAL_MODE === 'true';

/** Where the folder a graph was last opened from is written down, under
 *  `Files.dataPath`. */
export const OPEN_VAULT_FILE = 'vault.json';

const utf8 = new TextEncoder();
const text = new TextDecoder();

/** The folder this device last had a graph in. `undefined` is a device with
 *  none, which is the first run — and so is a record that can no longer be read
 *  or reached, because being asked for a folder again is a smaller loss than
 *  refusing to start. */
export async function rememberedVault(files: Files): Promise<string | undefined> {
	try {
		const own = files.at(await files.dataPath());
		const held = await own.read(OPEN_VAULT_FILE);
		if (!held) return undefined;
		const said: unknown = JSON.parse(text.decode(held));
		const folder = (said as { folder?: unknown } | null)?.folder;
		return typeof folder === 'string' && folder ? folder : undefined;
	} catch {
		return undefined;
	}
}

export async function rememberVault(files: Files, folder: string): Promise<void> {
	const own = files.at(await files.dataPath());
	await own.write(OPEN_VAULT_FILE, utf8.encode(`${JSON.stringify({ folder }, null, 2)}\n`));
}

/**
 * The vault a folder holds: the folder itself where it is a graph, and
 * otherwise the container a project keeps its notes in —
 * docs/ARCHITECTURE.md § "A project's container".
 */
export async function vaultIn(files: Files, folder: string): Promise<string> {
	const at = files.at(folder);
	if (await holdsAGraph(at)) return folder;
	return (await containerOf(at))?.root ?? folder;
}

/**
 * The folder somebody picked for a vault: a project's own root where the vault
 * is the container inside it, and otherwise the vault. What this device writes
 * down and reads is the vault; what it lists and takes back is the folder.
 */
export function folderOf(vault: string): string {
	const at = Math.max(vault.lastIndexOf('/'), vault.lastIndexOf('\\'));
	return at > 0 && vault.slice(at + 1) === CONTAINER_DIR ? vault.slice(0, at) : vault;
}

/**
 * Every folder this device knows, the one opened most recently first. `open` is
 * the vault being served, which belongs on the list whether or not anything
 * has written it down yet — a folder becomes a graph the first time it is read.
 */
export async function knownFolders(files: Files, open?: string): Promise<KnownFolder[]> {
	const known = (await readVaults(files.at(await files.dataPath())))
		.slice()
		.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
		.map((one) => one.root);
	const roots = open !== undefined && !known.includes(open) ? [open, ...known] : known;
	return Promise.all(roots.map((root) => folderAt(files, root)));
}

/** Say a folder this device knows has just been opened, so the list reads
 *  newest first. */
export async function openedFolder(files: Files, root: string): Promise<void> {
	await vaultOpened(files.at(await files.dataPath()), root);
}

/** Take a folder off this device's list. Nothing in the folder is touched. */
export async function forgetFolder(files: Files, root: string): Promise<void> {
	const own = files.at(await files.dataPath());
	await forgetVault(own, root);
	// A project's notes are listed under the project's own folder, so letting go
	// of the project lets go of the container they are in.
	await forgetVault(own, files.at(root).at(CONTAINER_DIR).root);
}

async function folderAt(files: Files, vault: string): Promise<KnownFolder> {
	const root = folderOf(vault);
	const graph = await graphIn(files, vault);
	return graph ? { root, graph, reachable: true } : { root, reachable: false };
}

async function graphIn(files: Files, root: string): Promise<KnownFolder['graph']> {
	try {
		const bytes = await files.at(root).read(GRAPH_FILE);
		if (!bytes) return undefined;
		const said = readGraphFile(bytes);
		return {
			ref: `${said.owner}/${said.graph}`,
			name: said.name,
			owner: said.owner,
			...(said.project === undefined ? {} : { project: said.project })
		};
	} catch {
		return undefined;
	}
}
