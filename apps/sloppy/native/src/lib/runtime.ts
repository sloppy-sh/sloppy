/**
 * This shell's half of the platform seam. `AppRuntime` in `@sloppy/app-core`
 * declares every member and what its absence decides; the job here is to fill in
 * the ones a webview inside a native process can answer differently from a tab.
 */

import { initRuntime, resetApi, session, type KnownFolder, type OpenTabs } from '@sloppy/app-core';
import {
	containerOf,
	DeviceCredentials,
	DeviceGitDefaults,
	DeviceThreads,
	holdsAGraph,
	LocalApi,
	readIdentities,
	whoWrites,
	type Credential,
	type Files,
	type IdentityAccess
} from '@sloppy/local';
import { ulid } from '@sloppy/types';
import { Refusal } from '@sloppy/ui';
import { GRAPH_FILE, readGraphFile } from '@sloppy/vault';
import { openUrl } from '@tauri-apps/plugin-opener';
import { tauriChat } from './chat';
import { SIGN_IN_CALLBACK } from './deep-link';
import { tauriDrafts } from './draft';
import { deviceAiKeys } from './ai-keys';
import { tauriFiles, tauriHistory, tauriOpenFile, tauriSaveFile } from './files';
import { tauriIdentities } from './identity';
import {
	forgetFolder,
	knownFolders,
	LOCAL_MODE,
	openedFolder,
	rememberedTabs,
	rememberTabs,
	graphIn
} from './local-mode';
import { picked, readsPicked } from './places';
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

/** The folder somebody picked, which for a project is its own root rather than
 *  the container the notes are in — docs/ARCHITECTURE.md § "A project's
 *  container". It is what this device lists and what the api reads the graph
 *  through; `createApi` reads it each time it is asked, so opening a folder
 *  re-points a running app. */
let opened: string | undefined;

/** Where the graph's own files are: that folder, or the container inside it.
 *  The history is the vault's, so it is asked of this and never of the folder
 *  on the list. */
let vaultRoot: string | undefined;

let missing = false;

/** The folders open at once and which of them is in front — what `TabsAccess`
 *  hands out, and what is written down each time it changes. */
let held: OpenTabs = { open: [], active: undefined };

const hearTabs = new Set<(tabs: OpenTabs) => void>();

function tabsChanged(): void {
	for (const hear of [...hearTabs]) hear(held);
}

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

/** The code the graph in front of somebody is written about, rooted at the
 *  project. `undefined` is a graph that is nobody's project. */
function projectHere(files: Files): Promise<Files | undefined> {
	return serving(files)
		.projectFolder()
		.catch(() => undefined);
}

async function ownerOf(files: Files, folder: string): Promise<ReturnType<typeof whoWrites>> {
	try {
		const bytes = await files.at(folder).read(GRAPH_FILE);
		return bytes ? readGraphFile(bytes).owner : undefined;
	} catch {
		return undefined;
	}
}

/** Settle who writes in the folder that is open and serve it under them. */
async function repoint(files: Files): Promise<void> {
	ownerHere = vaultRoot ? await ownerOf(files, vaultRoot) : undefined;
	writing = await writerFor(files, ownerHere);
	served = undefined;
	resetApi();
}

/** Which of the identities this device holds writes in a graph `owner` owns. A
 *  list this device cannot read leaves nobody named, so the refusal reaches
 *  somebody where they write rather than being turned into a fresh identity
 *  here. */
function writerFor(
	files: Files,
	owner?: ReturnType<typeof whoWrites>
): Promise<ReturnType<typeof whoWrites>> {
	return readIdentities(files).then(
		(identities) => whoWrites(identities, owner),
		() => undefined
	);
}

async function serve(files: Files, folder: string): Promise<void> {
	opened = folder;
	vaultRoot = (await containerOf(files.at(folder)).catch(() => undefined))?.root ?? folder;
	await repoint(files);
}

async function openFolder(files: Files): Promise<string | undefined> {
	const folder = await files.pickFolder();
	if (!folder) return undefined;
	await open(files, folder);
	return folder;
}

/**
 * The folder somebody picks for a project is the project's ROOT, and that is
 * the folder this device lists — docs/ARCHITECTURE.md § "A project's container".
 * `LocalApi` is what settles where the notes go inside it, so nothing is served
 * and nothing is written down until it has.
 */
/** A folder somebody names for a chat to read. The dialog writes it down as
 *  one this app may reach; nothing is opened, served or started in it. */
async function askPlace(files: Files): Promise<KnownFolder | undefined> {
	const root = await files.pickFolder('project');
	if (root === undefined) return undefined;
	await readsPicked();
	return { root, graph: await graphIn(files, root), reachable: true };
}

/** The folder somebody keeps a graph in is this app's own: one under its data,
 *  named by nothing a person would read, and listed like the ones they chose.
 *  The graph in it is started the first time it is read. */
async function startHere(files: Files): Promise<string> {
	const own = await files.dataPath();
	const inside = `graphs/${ulid()}`;
	await files.at(own).mkdir(inside);
	const root = `${own}/${inside}`;
	await open(files, root);
	return root;
}

async function openProject(files: Files): Promise<string | undefined> {
	const root = await files.pickFolder('project');
	if (!root) return undefined;
	const writer = await writerFor(files);
	await new LocalApi(files, writer === undefined ? {} : { writer }).openProject(root);
	await open(files, root);
	return root;
}

async function open(files: Files, folder: string): Promise<void> {
	// A folder somebody chose is theirs and may be anywhere, so where it is is
	// written down. The one a phone keeps its graphs in is asked for again each
	// launch instead: it moves with the app, and a path written down before it
	// moved leads nowhere.
	if (ASKS_WHERE) {
		held = {
			open: held.open.includes(folder) ? held.open : [...held.open, folder],
			active: folder
		};
		await rememberTabs(files, held);
		await openedFolder(files, folder);
	}
	await serve(files, folder);
	tabsChanged();
}

/** Take a folder's tab off, putting the one after it in front — else the one
 *  before — where it was the folder being read. */
async function closeTab(files: Files, root: string): Promise<void> {
	const put = held.open.indexOf(root);
	if (put < 0) return;
	if (held.open.length < 2) throw new Refusal('Keep at least one folder open.');
	const open = held.open.filter((one) => one !== root);
	const front = held.active === root ? (open[put] ?? open[put - 1]) : held.active;
	held = { open, active: front };
	await rememberTabs(files, held);
	if (front !== undefined && front !== opened) await serve(files, front);
	tabsChanged();
}

/** Take a folder off this device's list, and its tab with it — unless it is the
 *  one being read, which keeps its place in front of somebody rather than being
 *  taken out from under the page holding it. Served again either way, from a
 *  client that has not read the list as it was. */
async function forget(files: Files, folder: string): Promise<void> {
	await forgetFolder(files, folder);
	if (held.active !== folder && held.open.includes(folder)) await closeTab(files, folder);
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
 * The folder this device had in front, opened before any page reads `api`, with
 * the ones open beside it held again. `undefined` is a device with none, which
 * is what puts the first run in front of somebody instead — and is what is left
 * where a device that keeps its graphs in one place cannot reach that place
 * either.
 */
export async function openRememberedVault(): Promise<string | undefined> {
	if (!device) return undefined;
	await readsPicked();
	if (!ASKS_WHERE) return openFolder(device).catch(() => undefined);
	const remembered = await rememberedTabs(device);
	if (!remembered) return undefined;
	const stands = await Promise.all(
		remembered.open.map((root) => stillHoldsIt(device, root).catch(() => false))
	);
	const standing = remembered.open.filter((_, at) => stands[at]);
	const front =
		remembered.active !== undefined && standing.includes(remembered.active)
			? remembered.active
			: standing[0];
	// Being offered a folder again is for somebody who has lost all of them; one
	// of several that has gone is simply not opened.
	missing = front === undefined;
	if (front === undefined) return undefined;
	held = { open: standing, active: front };
	await rememberTabs(device, held);
	await serve(device, front);
	tabsChanged();
	return front;
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
					gitDefaults: new DeviceGitDefaults(device),
					credentials: new DeviceCredentials(device),
					aiKeys: deviceAiKeys(device),
					threads: new DeviceThreads(device),
					placeFiles: (root: string) => (picked(root) ? device.at(root) : undefined),
					askPlace: () => askPlace(device),
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
									startHere: () => startHere(device),
									openProject: () => openProject(device),
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
					// A device that keeps its graphs in one place has one folder by the
					// nature of where they are, so there is nothing to tell apart there.
					...(ASKS_WHERE
						? {
								tabs: {
									held: () => held,
									close: (root: string) => closeTab(device, root),
									changed: (hear: (tabs: OpenTabs) => void) => {
										hearTabs.add(hear);
										return () => {
											hearTabs.delete(hear);
										};
									}
								}
							}
						: {}),
					history: () => (vaultRoot ? tauriHistory(vaultRoot) : undefined),
					project: () => projectHere(device),
					chat: tauriChat(
						async () => (await projectHere(device))?.root,
						tauriDrafts(() => vaultRoot, device)
					)
				}
			: {})
	});
}
