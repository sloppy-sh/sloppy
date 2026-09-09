/**
 * Whether this build opens a graph as a folder on the device, and which folder
 * it opened last — docs/ARCHITECTURE.md § "Local-only mode".
 */

import type { Files } from '@sloppy/local';

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
