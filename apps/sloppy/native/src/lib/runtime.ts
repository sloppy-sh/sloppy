/**
 * This shell's half of the platform seam. `AppRuntime` in `@sloppy/app-core`
 * declares every member and what its absence decides; the job here is to fill in
 * the ones a webview inside a native process can answer differently from a tab.
 */

import { initRuntime } from '@sloppy/app-core';
import { invoke } from '@tauri-apps/api/core';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { openUrl } from '@tauri-apps/plugin-opener';
import { LOCAL_MODE_AVAILABLE } from './local-mode';

/** An ORIGIN, never a path — `@sloppy/client` owns everything after it. No
 *  hosted Sloppy exists yet, so the fallback is the API's own dev default
 *  (`AppConfigService`) and a fresh clone runs with no .env at all. */
const API_HOST = String(import.meta.env.PUBLIC_API_URL || 'http://localhost:8020').replace(
	/\/+$/,
	''
);

async function nativeAssetBytes(url: string): Promise<ArrayBuffer> {
	// Only a remote host needs the hop out of the webview; a data: URL or a
	// bundled asset is already ours and the webview's own fetch reaches it.
	const remote = /^https?:\/\//i.test(url);
	const res = remote ? await tauriFetch(url) : await globalThis.fetch(url);
	if (!res.ok) throw new Error(`asset fetch ${res.status} for ${url}`);
	return res.arrayBuffer();
}

export function initNativeRuntime(): void {
	initRuntime({
		apiHost: () => API_HOST,
		assetBytes: nativeAssetBytes,
		// A webview cannot host somebody else's sign-in page, so consent opens in
		// the system browser and returns through `deep-link.ts`.
		openExternal: (url) => openUrl(url),
		// Only a build carrying the on-device engine has anything on disk to erase.
		wipeLocal: LOCAL_MODE_AVAILABLE ? () => invoke<void>('db_wipe') : undefined
	});
}
