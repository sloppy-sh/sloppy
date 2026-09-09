/**
 * This shell's half of the platform seam. `AppRuntime` in `@sloppy/app-core`
 * declares every member and what its absence decides; the job here is to fill in
 * the ones a webview inside a native process can answer differently from a tab.
 */

import { initRuntime, resetApi, session } from '@sloppy/app-core';
import { LocalApi, type Files } from '@sloppy/local';
import { openUrl } from '@tauri-apps/plugin-opener';
import { SIGN_IN_CALLBACK } from './deep-link';
import { tauriFiles } from './files';
import { LOCAL_MODE, rememberedVault, rememberVault } from './local-mode';
import { IS_MOBILE, TAURI_PLATFORM } from './platform';

/** An Android emulator's loopback is the emulated device itself; 10.0.2.2 is
 *  the machine it runs on. */
const DEV_API_ORIGIN =
	TAURI_PLATFORM === 'android' ? 'http://10.0.2.2:8020' : 'http://localhost:8020';

/** An ORIGIN, never a path — `@sloppy/client` owns everything after it. No
 *  hosted Sloppy exists yet, so the fallback is the API's own dev default
 *  (`AppConfigService`) and a fresh clone runs with no .env at all. */
const API_HOST = (import.meta.env.PUBLIC_SLOPPY_API_URL || DEV_API_ORIGIN).replace(/\/+$/, '');

const device = LOCAL_MODE ? tauriFiles() : undefined;

/** A phone and a tablet keep their graphs in one place, so opening one there
 *  answers with that place rather than asking. */
const ASKS_WHERE = !IS_MOBILE;

/** The folder the graph in front of somebody is in. `createApi` reads it each
 *  time it is asked, so opening a folder re-points a running app. */
let opened: string | undefined;

function serve(folder: string): void {
	opened = folder;
	resetApi();
}

async function openFolder(files: Files): Promise<string | undefined> {
	const folder = await files.pickFolder();
	if (!folder) return undefined;
	await rememberVault(files, folder);
	serve(folder);
	return folder;
}

/**
 * The folder this device had a graph in last, opened again, before any page
 * reads `api`. `undefined` is a device with none, which is what puts the first
 * run in front of somebody instead. A device that keeps its graphs in one place
 * has nothing to be asked about, so its folder is opened here, and the first
 * run is what is left when even that fails.
 */
export async function openRememberedVault(): Promise<string | undefined> {
	if (!device) return undefined;
	const remembered = await rememberedVault(device);
	if (remembered) {
		serve(remembered);
		return remembered;
	}
	if (ASKS_WHERE) return undefined;
	return openFolder(device).catch(() => undefined);
}

export function initNativeRuntime(): void {
	initRuntime({
		apiHost: () => API_HOST,
		mode: () => (device ? 'local' : 'hosted'),
		onAuthInvalid: () => session.clear(),
		// The return leg is `deep-link.ts`.
		openExternal: (url) => openUrl(url),
		// A webview origin is not an address the system browser can navigate to,
		// so consent comes back over the scheme this app is registered for.
		signInRedirect: () => SIGN_IN_CALLBACK,
		// Nothing in this shell writes a file yet.
		saveFile: null,
		...(device
			? {
					createApi: () => new LocalApi(opened ? device.at(opened) : device),
					// A graph on this device holds no address of anybody else's, so
					// there is nothing here the proxy would be keeping off them.
					assetSrc: (src: string) => src,
					vault: {
						folder: () => opened,
						asks: ASKS_WHERE,
						open: () => openFolder(device)
					}
				}
			: {})
	});
}
