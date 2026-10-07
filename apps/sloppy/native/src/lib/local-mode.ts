/**
 * Whether this build opens a graph as a folder on the device, and which folders
 * it had open — docs/ARCHITECTURE.md § "Local-only mode" and § "Several folders
 * open at once".
 */

import type { KnownFolder, OpenTabs } from '@sloppy/app-core';
import { containerOf, forgetVault, readVaults, vaultOpened, type Files } from '@sloppy/local';
import { GRAPH_FILE, readGraphFile } from '@sloppy/vault';

/**
 * `scripts/tauri.sh` is the only writer of PUBLIC_ENABLE_LOCAL_MODE: it writes
 * `true` unless somebody asked for a build that talks to a server. Anything
 * else — a frontend built outside that script, the variable unset — is a build
 * that talks to one, and offers a folder on this device from its sign-in screen
 * instead of serving one from the start.
 *
 * Read through `import.meta.env` rather than `$env/static/public`, which throws
 * when the variable is unset.
 */
export const LOCAL_MODE: boolean = import.meta.env.PUBLIC_ENABLE_LOCAL_MODE === 'true';

/** Where the folders a graph was last opened from are written down, under
 *  `Files.dataPath`. */
export const OPEN_VAULT_FILE = 'vault.json';

const utf8 = new TextEncoder();
const text = new TextDecoder();

/** The folders this device had open and which of them was in front.
 *  `undefined` is a device with none, which is the first run — and so is a
 *  record that can no longer be read or reached, because being asked for a
 *  folder again is a smaller loss than refusing to start. */
export async function rememberedTabs(files: Files): Promise<OpenTabs | undefined> {
	try {
		const own = files.at(await files.dataPath());
		const held = await own.read(OPEN_VAULT_FILE);
		if (!held) return undefined;
		return tabsIn(JSON.parse(text.decode(held)));
	} catch {
		return undefined;
	}
}

export async function rememberTabs(files: Files, tabs: OpenTabs): Promise<void> {
	const own = files.at(await files.dataPath());
	const said = {
		open: [...tabs.open],
		...(tabs.active === undefined ? {} : { active: tabs.active })
	};
	await own.write(OPEN_VAULT_FILE, utf8.encode(`${JSON.stringify(said, null, 2)}\n`));
}

/** A record written down before this device held more than one folder open
 *  names the one folder it had, under `folder`. */
function tabsIn(said: unknown): OpenTabs | undefined {
	const read = (said ?? {}) as { open?: unknown; active?: unknown; folder?: unknown };
	const listed: unknown[] = Array.isArray(read.open) ? read.open : [read.folder];
	const open = [
		...new Set(listed.filter((one): one is string => typeof one === 'string' && one !== ''))
	];
	if (open.length === 0) return undefined;
	const active =
		typeof read.active === 'string' && open.includes(read.active) ? read.active : open[0];
	return { open, active };
}

/** The folder in front, for `folders.ts`: a build that talks to a server opens
 *  one at a time, and reaches the same record. */
export async function rememberedVault(files: Files): Promise<string | undefined> {
	return (await rememberedTabs(files))?.active;
}

export async function rememberVault(files: Files, folder: string): Promise<void> {
	await rememberTabs(files, { open: [folder], active: folder });
}

/** Ask for a folder on the next launch rather than opening one again. Nothing
 *  in the folder is touched, and this device still knows it. */
export async function forgetOpenVault(files: Files): Promise<void> {
	const own = files.at(await files.dataPath());
	await own.remove(OPEN_VAULT_FILE);
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

export async function graphIn(files: Files, root: string): Promise<KnownFolder['graph']> {
	try {
		const at = files.at(root);
		const bytes = (await at.read(GRAPH_FILE)) ?? (await (await containerOf(at))?.read(GRAPH_FILE));
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
