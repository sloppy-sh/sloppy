/**
 * The platform seam. Everything that differs between the web shell and the
 * native (Tauri) shell lives behind this one interface, which is what lets one
 * codebase serve both — docs/ARCHITECTURE.md § "The two files that carry the
 * platform seam".
 *
 * **The ABSENCE of an optional member is meaningful**, and each line below says
 * what its absence decides. A shell leaves a member out to choose the default
 * behaviour, never because it has nothing to put there.
 */

import { setHost } from '@sloppy/client';
import type {
	Credential,
	CredentialsAccess,
	Files,
	GitDefaultsAccess,
	History,
	IdentityAccess
} from '@sloppy/local';
import type {
	DidSyr,
	DocumentingIntent,
	DocumentingPlan,
	DocumentingProgress,
	DocumentingTool,
	OwnedRef,
	ProposedPlace
} from '@sloppy/types';
import type { SloppyApi } from './api.js';
import { storedOrigin } from './stores/prefs.svelte.js';

/**
 * Which of the three deployments this app is running as
 * (docs/ARCHITECTURE.md § "Deployment modes"). It is what copy about where a
 * person's writing lives reads; `createApi` below is what the api layer reads.
 */
export type DeploymentMode = 'hosted' | 'self_hosted' | 'local';

/** One of the folders this device knows, as a list of them shows it. */
export interface KnownFolder {
	/** As the platform spells it, which is what opening one takes. */
	root: string;
	/** The graph in it, as its own `graph.json` says. Absent where this device
	 *  could not read one just now — a folder that is not there, or one holding
	 *  none yet. `owner` is whose folder it is, which is what says whether
	 *  closing it is this device's act; what they are called is `profileOf`'s
	 *  answer here as everywhere else, so no list holds a second copy of it.
	 *  `project` is where the code the graph is about is, as the graph says it;
	 *  absent is a graph that is nobody's project. */
	graph?: { ref: OwnedRef; name: string; owner: DidSyr; project?: string };
	/** Whether the folder is where this device last saw it. A folder that is
	 *  gone is still listed, because a person moved it and is the only one who
	 *  can say where to. */
	reachable: boolean;
}

/** The folder a graph on this device is kept in, and the one act that puts one
 *  there. The shell owns where a folder comes from; a page only asks. */
export interface VaultAccess {
	/** `undefined` before any folder has been opened, which is the first run. */
	folder(): string | undefined;
	/** The graph in the folder that is open, which is the one in front of
	 *  somebody here. A folder holding none is a folder somebody has just said a
	 *  graph is in, so one is started there. `undefined` while no folder is
	 *  open, which is the first run. */
	graph(): Promise<OwnedRef | undefined>;
	/** Open a folder and serve the graph in it from now on. `undefined` is
	 *  somebody who named none, and is not a failure. */
	open(): Promise<string | undefined>;
	/** Whether {@link open} asks somebody where. False is a device that keeps
	 *  its graphs in one place, and the offer says so rather than promising a
	 *  choice nobody gets. */
	readonly asks: boolean;
	/** Whether this folder stands alongside the graphs a Sloppy serves and is
	 *  closed again — a folder opened in a browser tab. Absent → the folder is
	 *  the only graph there is, so the graph a reader chose in another one is
	 *  let go of when this one opens. */
	readonly alongside?: boolean;
	/**
	 * Every folder this device knows, newest first. Absent, like the four acts
	 * below, is a shell that keeps one folder and no list of them, so nothing
	 * about choosing between them is put in front of anybody; a shell that
	 * defines one of them defines all of them.
	 */
	known?(): Promise<KnownFolder[]>;
	/** Serve the graph in that folder from now on. */
	openKnown?(root: string): Promise<void>;
	/** Take it off this device's list. Nothing in the folder is touched, and a
	 *  person opens it again by naming it again. */
	forget?(root: string): Promise<void>;
	/** The same act as {@link VaultAccess.open} for a folder a person means to
	 *  fill: what separates the two is the words the offer is made in — opening
	 *  a folder that holds a graph, or starting one that will.
	 *  `undefined` is somebody who named none. */
	start?(): Promise<string | undefined>;
	/** A copy of a graph kept somewhere else, brought onto this device.
	 *  `undefined` is somebody who chose not to say where to put it. */
	clone?(url: string, credential?: Credential): Promise<string | undefined>;
	/** Ask somebody for a project's root folder and serve the notes kept inside
	 *  it from now on, starting them where the project has none yet. Resolves
	 *  with the folder now open, or `undefined` where nobody named one. Absent
	 *  is a shell that cannot reach a project's own folder, and nothing about
	 *  opening one is put in front of anybody. */
	openProject?(): Promise<string | undefined>;
}

/**
 * Asking a tool on this device to read the project and write its notes, and
 * watching what comes back — docs/ARCHITECTURE.md § "Asking a tool to write
 * the notes". A page asks for a survey and for a run, and learns nothing else
 * about how either happens.
 *
 * **One at a time, counting both.** A survey and a run are the same one thing
 * underway here, so either asked while either is underway REJECTS rather than
 * starting a second, queueing it or replacing the first, and {@link
 * DocumentingAccess.stop} ends whichever of the two it is.
 *
 * **The IMPLEMENTATION parses, in both directions, and no caller repeats it.**
 * The members below take and answer plain TypeScript, which holds nothing at
 * runtime, and every path in these shapes reaches a program: a place a tool
 * emitted by reading somebody's checked-out tree and a place a person typed
 * into a field are equally unvouched-for. So a shell parses what it is handed
 * (`DocumentingIntentSchema`, `DocumentingPlanSchema`) before acting on any of
 * it, and parses what it answers with (`ProposedPlaceSchema`,
 * `DocumentingProgressSchema`) before a page sees it — rejecting what does not
 * parse rather than dropping it, so nobody is told a place was written about
 * that was not. **Two of those checks are not in the shapes**, because a
 * refinement there would take `.omit()` and `.partial()` with it:
 * `placesAreDistinct` over the places of a plan it is handed and of a survey
 * it answers with, and `progressFits` over every progress it reports. A page
 * spells no check of its own, the way a caller of `Files` in `@sloppy/local`
 * spells no check that a path stays inside the root.
 */
export interface DocumentingAccess {
	/** The tools this device can reach. An EMPTY list is a device with none. */
	tools(): Promise<DocumentingTool[]>;
	/**
	 * Read the project against what somebody asked for, and propose the places
	 * worth a note — at most `MAX_PLACES_PER_RUN` of them, which is what a plan
	 * may carry. Nothing is written.
	 *
	 * An EMPTY list is a survey proposing none: one that found nothing worth a
	 * note, and one somebody stopped, which proposes none of what it had
	 * reached. **A survey that could not go on REJECTS**, with words for the
	 * person in its message, which are the ones the surface shows — trouble is
	 * never folded into the empty list, because that tells somebody there is
	 * nothing worth writing about when in fact nothing ran.
	 */
	survey(intent: DocumentingIntent): Promise<ProposedPlace[]>;
	/**
	 * Write the notes the plan names, in its order, telling `watch` each time
	 * the answer changes and resolving with the last answer it gave.
	 *
	 * **A run holds ITSELF to `writesAlone`**, because the store will not: a
	 * project's container is an open graph, so `writeOutcome` answers `lands`
	 * for every writer on every note in it. `writeOnto` in `@sloppy/local` is
	 * that rule written once — it writes onto the note where `writesAlone` is
	 * true and proposes an amendment where it is not — and a run goes through
	 * it rather than calling the store directly.
	 *
	 * **A run writes as the notes' own container, and never as the person.**
	 * Its writer is the identity kept in the container's own private data,
	 * minted there the first time — the one `sloppy draft` writes under, and
	 * never one on the list this app writes under: a run holding that one lands
	 * on every note its person has written instead of offering. A store reaches
	 * it by being given files that keep their data at `containerDataAt(project)`
	 * — `keepingDataAt` in `@sloppy/local`, both from there, and **the path is
	 * that function's answer and nothing spelled again here**: a second folder
	 * is a second identity in one container, and the two then offer each other
	 * amendments to notes no person has written in. A shell's own files answer
	 * with the app's own data path however they are re-rooted, so a store handed
	 * those writes as the person. `PlaceDone` says which of the two happened at
	 * each place.
	 */
	run(
		plan: DocumentingPlan,
		watch: (progress: DocumentingProgress) => void
	): Promise<DocumentingProgress>;
	/** End what is underway here, resolving once it has ended — after that act's
	 *  own promise has settled, so another may be asked for the moment this
	 *  resolves. Nothing underway is not a failure. */
	stop(): Promise<void>;
}

export interface AppRuntime {
	/** The origin this build shipped with, or `''` for same-origin. A device
	 *  pointed at another Sloppy is served by that one instead, and returning to
	 *  the default returns to this. `initRuntime` publishes the answer to
	 *  `@sloppy/client`'s host module, so nothing else spells a URL. */
	apiHost(): string;
	mode(): DeploymentMode;
	token: {
		get(): string | undefined;
		set(v: string): void;
		clear(): void;
	};
	fetchImpl(): typeof fetch;
	/** Absent → a rejected session surfaces wherever it was noticed. Present →
	 *  the shell signs out app-wide. */
	onAuthInvalid?(): void;
	/** Absent on web, where syr's consent page navigates the current tab.
	 *  Present on native, which opens the system browser so consent returns via
	 *  a deep link — a WebView cannot host somebody else's sign-in. */
	openExternal?(url: string): Promise<void> | void;
	/** Where consent puts somebody down when it is done, as an absolute URL.
	 *  Absent → `${location.origin}/`, which is where a tab already stands. A
	 *  shell the system browser cannot navigate back into names a URL that
	 *  reaches it instead, and the API only hands a session to a target it
	 *  recognises. */
	signInRedirect?(): string;
	/** PRESENT means this platform can serve the graph with no network at all:
	 *  the folder on the device is the whole store. Absent → the remote client.
	 *  A shell that defines it reports `mode() === 'local'` while it is in use,
	 *  and calls {@link resetApi} when that changes. */
	createApi?(): SloppyApi;
	/** Where a note of this person's is opened on the web, as an origin. Absent →
	 *  the page's own, which is the answer wherever the shell is served from one
	 *  a peer could open; a shell that is not names this or nothing. */
	webOrigin?(): string | undefined;
	/** Hand a person a file to keep. Absent → the browser saves it, which is
	 *  what a tab does and a webview does not, so a shell inside one supplies
	 *  this; `null` where it has no way to save one, and the offer of a copy
	 *  says so rather than doing nothing. */
	saveFile?: ((name: string, body: Blob) => Promise<void>) | null;
	/** Ask a person for a file to bring in; `accept` is a file input's list of
	 *  extensions. Resolving to `null` is a person who chose none. Absent → a
	 *  file input on the page, which is what a tab has; `null` where the shell
	 *  has no way to ask at all, and the offer says so rather than doing
	 *  nothing. */
	openFile?: ((accept: string) => Promise<File | null>) | null;
	/** Present where the graph in front of somebody is a folder on this device,
	 *  and absent everywhere else — a shell that defines it also defines
	 *  {@link createApi}. It is what the first-run surface asks for a folder
	 *  with, so no page spells a platform's way of finding one. */
	vault?: VaultAccess;
	/** The identities this device holds, and the three ways one arrives —
	 *  a shell that defines it also defines {@link AppRuntime.vault}. Absent →
	 *  this platform keeps no identity of its own, so nothing about holding,
	 *  choosing or carrying one is put in front of anybody. `IdentityAccess` in
	 *  `@sloppy/local` declares every act. */
	identities?: IdentityAccess;
	/** The states the graph in front of somebody has been in — a shell that
	 *  defines it also defines {@link AppRuntime.vault}. Absent → this platform
	 *  keeps no history of a graph, and nothing about one is put in front of
	 *  anybody; `undefined` from it is a shell that keeps histories with no
	 *  graph open. `History` in `@sloppy/local` declares every act. */
	history?(): History | undefined;
	/** The code the graph in front of somebody is written about, rooted at the
	 *  project — a shell that defines it also defines {@link AppRuntime.vault}.
	 *  Absent → this platform reads no folder. `undefined` from it is a graph
	 *  that is nobody's project, where an anchor into code is the ordinary link
	 *  it is and nothing is offered to point at one; docs/ARCHITECTURE.md § "A
	 *  project's container" is what decides which. */
	project?(): Promise<Files | undefined>;
	/** What a folder started on this device begins with, kept beside the
	 *  graphs rather than in one — a shell that defines it also defines
	 *  {@link AppRuntime.vault}. Absent → nothing here can be told who its
	 *  commits are by, and nothing about that is put in front of anybody.
	 *  `GitDefaultsAccess` in `@sloppy/local` declares every act. */
	gitDefaults?: GitDefaultsAccess;
	/** What this device was given to reach the hosts a person keeps their
	 *  folders on. Absent → this platform holds none, so nothing is offered
	 *  that would need one. `CredentialsAccess` in `@sloppy/local` declares
	 *  every act. */
	credentials?: CredentialsAccess;
	/** Asking a tool on this device to write the project's notes — a shell that
	 *  defines it also defines {@link AppRuntime.project}. Absent → nothing here
	 *  can run a program of the person's, so nothing about writing the notes
	 *  this way is put in front of anybody, which is every browser tab.
	 *  {@link DocumentingAccess} declares every act. */
	documenting?: DocumentingAccess;
	/** How a stored picture's address becomes one this page can load. Absent →
	 *  the API's proxy, so viewing somebody else's note never reaches their
	 *  instance from here. A shell serving a graph off the device answers with
	 *  the address its own webview loads a file from — nothing it holds is
	 *  somebody else's to leak. */
	assetSrc?(src: string): string;
}

const TOKEN_KEY = 'sloppy_token';

/**
 * Existing and being readable are different things: a browser told to block site
 * data throws on the accessor itself, so `typeof localStorage` is not a guard —
 * it throws too. This runs at module scope, so an unguarded read loses the whole
 * app at import for anyone with cookies off. They get a session that lasts the
 * life of the tab instead.
 */
function storedToken(): string | undefined {
	try {
		return localStorage.getItem(TOKEN_KEY) ?? undefined;
	} catch {
		return undefined;
	}
}

function storeToken(v: string | undefined): void {
	try {
		if (v === undefined) localStorage.removeItem(TOKEN_KEY);
		else localStorage.setItem(TOKEN_KEY, v);
	} catch {
		// Memory already holds it; persisting is the only thing lost.
	}
}

let memToken: string | undefined = storedToken();

const localStorageToken: AppRuntime['token'] = {
	get: () => memToken,
	set: (v) => {
		memToken = v;
		storeToken(v);
	},
	clear: () => {
		memToken = undefined;
		storeToken(undefined);
	}
};

let current: AppRuntime = {
	apiHost: () => '',
	mode: () => 'hosted',
	token: localStorageToken,
	fetchImpl: () => globalThis.fetch.bind(globalThis)
};

function host(): string {
	return storedOrigin() ?? current.apiHost();
}

/**
 * Call from the shell's root layout, before any page mounts. Unset fields keep
 * their defaults, and it is idempotent.
 */
export function initRuntime(rt: Partial<AppRuntime> & Pick<AppRuntime, 'apiHost'>): void {
	updateRuntime(rt);
}

/**
 * Settle a member again while the app is running, for a shell that serves the
 * graph from one place and then from another. A field passed as `undefined`
 * becomes absent, which is what puts its documented absence back; a field left
 * out is untouched. The caller swaps what serves the app, so it calls
 * {@link resetApi} as well.
 */
export function updateRuntime(rt: Partial<AppRuntime>): void {
	current = { ...current, ...rt };
	setHost(host());
}

/**
 * Point a running app at the Sloppy this device now names. That alone re-points
 * a live client, because the client reads the host per request — swapping
 * remote ↔ local is what additionally needs {@link resetApi}.
 *
 * A session belongs to the Sloppy that opened it, so the caller ends it and
 * lets go of what was read as well.
 */
export function repointRuntime(): void {
	setHost(host());
}

/** Late-binding facade — modules hold this, never the config object itself. */
export const runtime = {
	/** The origin in use — the one this device names, else {@link AppRuntime.apiHost}. */
	apiHost: () => host(),
	mode: () => current.mode(),
	token: {
		get: () => current.token.get(),
		set: (v: string) => current.token.set(v),
		clear: () => current.token.clear()
	},
	fetchImpl: () => current.fetchImpl(),
	authInvalid: () => current.onAuthInvalid?.(),
	openExternal: (): AppRuntime['openExternal'] => current.openExternal,
	signInRedirect: (): string | undefined => current.signInRedirect?.(),
	createApi: (): SloppyApi | undefined => current.createApi?.(),
	webOrigin: (): string | undefined => current.webOrigin?.(),
	vault: (): VaultAccess | undefined => current.vault,
	identities: (): IdentityAccess | undefined => current.identities,
	history: (): History | undefined => current.history?.(),
	project: async (): Promise<Files | undefined> => current.project?.(),
	gitDefaults: (): GitDefaultsAccess | undefined => current.gitDefaults,
	credentials: (): CredentialsAccess | undefined => current.credentials,
	documenting: (): DocumentingAccess | undefined => current.documenting,
	saveFile: (): AppRuntime['saveFile'] => current.saveFile,
	openFile: (): AppRuntime['openFile'] => current.openFile,
	assetSrc: (): AppRuntime['assetSrc'] => current.assetSrc
};
