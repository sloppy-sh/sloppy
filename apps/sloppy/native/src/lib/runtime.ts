/**
 * This shell's half of the platform seam. `AppRuntime` in `@sloppy/app-core`
 * declares every member and what its absence decides; the job here is to fill in
 * the ones a webview inside a native process can answer differently from a tab.
 */

import { initRuntime, resetApi, session } from '@sloppy/app-core';
import {
	holdsAGraph,
	LocalApi,
	readIdentities,
	whoWrites,
	type Credential,
	type Files,
	type IdentityAccess
} from '@sloppy/local';
import { GRAPH_FILE, readGraphFile } from '@sloppy/vault';
import { openUrl } from '@tauri-apps/plugin-opener';
import { SIGN_IN_CALLBACK } from './deep-link';
import { tauriFiles, tauriHistory, tauriOpenFile, tauriSaveFile } from './files';
import { tauriIdentities } from './identity';
import {
	forgetFolder,
	knownFolders,
	LOCAL_MODE,
	openedFolder,
	rememberedVault,
	rememberVault
} from './local-mode';
import { IS_MOBILE, TAURI_PLATFORM } from './platform';

/** An Android emulator's loopback is the emulated device itself; 10.0.2.2 is
 *  the machine it runs on. */
const DEV_API_ORIGIN =
	TAURI_PLATFORM === 'android' ? 'http://10.0.2.2:8020' : 'http://localhost:8020';

/** An ORIGIN, never a path — `@sloppy/client` owns everything after it. No
 *  hosted Sloppy exists yet, so the fallback is the API's own dev default
 *  (`AppConfigService`) and a fresh clone runs with no .env at all. */
const API_HOST = (import.meta.env.PUBLIC_SLOPPY_API_URL || DEV_API_ORIGIN).replace(/\/+$/, '');

/** This app's own public web origin. An identity store is asked to delegate to
 *  it and to put somebody down on it, so it is a place a browser can reach and
 *  never this webview's own address. */
const APP_ORIGIN = (import.meta.env.PUBLIC_SLOPPY_APP_ORIGIN || 'https://sloppy.sh').replace(
	/\/+$/,
	''
);

const device = LOCAL_MODE ? tauriFiles() : undefined;

/** A phone and a tablet keep their graphs in one place, so opening one there
 *  answers with that place rather than asking. */
const ASKS_WHERE = !IS_MOBILE;

/** The folder the graph in front of somebody is in. `createApi` reads it each
 *  time it is asked, so opening a folder re-points a running app. */
let opened: string | undefined;

let missing = false;

let served: LocalApi | undefined;

/** Who the graph in the folder that is open belongs to, and which of the
 *  identities this device holds writes in it. */
let ownerHere: ReturnType<typeof whoWrites>;
let writing: ReturnType<typeof whoWrites>;

/** A reader and writer over the folder that is open. app-core asks for one
 *  again only after `resetApi`, and by then the folder is at a state the last
 *  one's index is not — a commit switched, a merge landed — so every ask is
 *  answered with its own. */
function fresh(files: Files): LocalApi {
	return (served = new LocalApi(
		opened ? files.at(opened) : files,
		writing === undefined ? {} : { writer: writing }
	));
}

/** The one the app is reading, so the graph the app is in and the graph a page
 *  asks about are the same one. */
function serving(files: Files): LocalApi {
	return served ?? fresh(files);
}

async function ownerOf(files: Files, folder: string): Promise<ReturnType<typeof whoWrites>> {
	try {
		const bytes = await files.at(folder).read(GRAPH_FILE);
		return bytes ? readGraphFile(bytes).owner : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Settle who writes in the folder that is open and serve it under them. A list
 * this device cannot read leaves nobody named, so the refusal reaches somebody
 * where they write rather than being turned into a fresh identity here.
 */
async function repoint(files: Files): Promise<void> {
	ownerHere = opened ? await ownerOf(files, opened) : undefined;
	writing = await readIdentities(files).then(
		(held) => whoWrites(held, ownerHere),
		() => undefined
	);
	served = undefined;
	resetApi();
}

async function serve(files: Files, folder: string): Promise<void> {
	opened = folder;
	await repoint(files);
}

async function openFolder(files: Files): Promise<string | undefined> {
	const folder = await files.pickFolder();
	if (!folder) return undefined;
	await open(files, folder);
	return folder;
}

async function open(files: Files, folder: string): Promise<void> {
	// A folder somebody chose is theirs and may be anywhere, so where it is is
	// written down. The one a phone keeps its graphs in is asked for again each
	// launch instead: it moves with the app, and a path written down before it
	// moved leads nowhere.
	if (ASKS_WHERE) {
		await rememberVault(files, folder);
		await openedFolder(files, folder);
	}
	await serve(files, folder);
}

/** Take a folder off this device's list and serve what is open from a client
 *  that has not read the list as it was. */
async function forget(files: Files, folder: string): Promise<void> {
	await forgetFolder(files, folder);
	await repoint(files);
}

async function cloneFolder(
	files: Files,
	url: string,
	credential?: Credential
): Promise<string | undefined> {
	const into = await files.pickFolder();
	if (!into) return undefined;
	await files.clone?.(url, into, credential);
	await open(files, into);
	return into;
}

/** Whether the folder this device had a graph in is not where it was. The first
 *  run is what somebody is offered then, and this is what it says there. */
export function vaultIsMissing(): boolean {
	return missing;
}

/** Whether the graph this device wrote down is still in that folder — the same
 *  question `@sloppy/local` asks of a folder it is handed, so a folder holding
 *  files but no graph is offered again here rather than read as one there. */
function stillHoldsIt(files: Files, folder: string): Promise<boolean> {
	return holdsAGraph(files.at(folder));
}

/**
 * The folder this device has a graph in, opened before any page reads `api`.
 * `undefined` is a device with none, which is what puts the first run in front
 * of somebody instead — and is what is left where a device that keeps its
 * graphs in one place cannot reach that place either.
 */
export async function openRememberedVault(): Promise<string | undefined> {
	if (!device) return undefined;
	if (!ASKS_WHERE) return openFolder(device).catch(() => undefined);
	const remembered = await rememberedVault(device);
	if (!remembered) return undefined;
	missing = !(await stillHoldsIt(device, remembered).catch(() => false));
	if (missing) return undefined;
	await serve(device, remembered);
	return remembered;
}

function identitiesHere(files: Files): IdentityAccess {
	return tauriIdentities(files, {
		origin: APP_ORIGIN,
		graphOwner: () => ownerHere,
		changed: () => repoint(files)
	});
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
		saveFile: tauriSaveFile(),
		...(device
			? {
					createApi: () => fresh(device),
					openFile: tauriOpenFile(),
					identities: identitiesHere(device),
					// A graph on this device holds no address of anybody else's, so
					// there is nothing here the proxy would be keeping off them.
					assetSrc: (src: string) => src,
					vault: {
						folder: () => opened,
						graph: async () => (opened ? serving(device).graphHere() : undefined),
						asks: ASKS_WHERE,
						open: () => openFolder(device),
						// A device that keeps its graphs in one place has one folder and no
						// list of them, so nothing about choosing between them is offered
						// there.
						...(ASKS_WHERE
							? {
									known: () => knownFolders(device, opened),
									openKnown: (root: string) => open(device, root),
									forget: (root: string) => forget(device, root),
									start: () => openFolder(device),
									// Absent where this shell has no way to bring a folder over.
									...(device.clone
										? {
												clone: (url: string, credential?: Credential) =>
													cloneFolder(device, url, credential)
											}
										: {})
								}
							: {})
					},
					history: () => (opened ? tauriHistory(opened) : undefined)
				}
			: {})
	});
}
