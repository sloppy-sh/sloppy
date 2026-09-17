/**
 * Whether this build opens a graph as a folder on the device, and which folder
 * it opened last — docs/ARCHITECTURE.md § "Local-only mode".
 */

import type { KnownFolder } from '@sloppy/app-core';
import { forgetVault, readVaults, vaultOpened, type Files } from '@sloppy/local';
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
 * Every folder this device knows, the one opened most recently first. `open` is
 * the folder being served, which belongs on the list whether or not anything
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
	await forgetVault(files.at(await files.dataPath()), root);
}

async function folderAt(files: Files, root: string): Promise<KnownFolder> {
	const graph = await graphIn(files, root);
	return graph ? { root, graph, reachable: true } : { root, reachable: false };
}

async function graphIn(files: Files, root: string): Promise<KnownFolder['graph']> {
	try {
		const bytes = await files.at(root).read(GRAPH_FILE);
		if (!bytes) return undefined;
		const said = readGraphFile(bytes);
		return { ref: `${said.owner}/${said.graph}`, name: said.name, owner: said.owner };
	} catch {
		return undefined;
	}
}
