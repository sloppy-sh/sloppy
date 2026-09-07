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
import type { SloppyApi } from './api.js';

/**
 * Which of the three deployments this app is running as
 * (docs/ARCHITECTURE.md § "Deployment modes"). It is what copy about where a
 * person's writing lives reads; `createApi` below is what the api layer reads.
 */
export type DeploymentMode = 'hosted' | 'self_hosted' | 'local';

export interface AppRuntime {
	/** The API's origin, or `''` for same-origin. `initRuntime` publishes it to
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
	 *  the embedded engine and the local IdP are built in. Absent → the remote
	 *  client. A shell that defines it reports `mode() === 'local'` while it is
	 *  in use, and calls {@link resetApi} when that changes. */
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

/**
 * Call from the shell's root layout, before any page mounts. Unset fields keep
 * their defaults.
 *
 * Idempotent: a shell re-runs it when the person points the app at another
 * server. That alone re-points a live client, because the client reads the host
 * per request — swapping remote ↔ local is what additionally needs
 * {@link resetApi}.
 */
export function initRuntime(rt: Partial<AppRuntime> & Pick<AppRuntime, 'apiHost'>): void {
	current = { ...current, ...rt };
	setHost(current.apiHost());
}

/** Late-binding facade — modules hold this, never the config object itself. */
export const runtime = {
	apiHost: () => current.apiHost(),
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
	saveFile: (): AppRuntime['saveFile'] => current.saveFile
};
