/**
 * This shell's half of the platform seam. `AppRuntime` in `@sloppy/app-core`
 * declares every member and what its absence decides; the job here is to fill in
 * the ones a webview inside a native process can answer differently from a tab.
 */

import { initRuntime, session } from '@sloppy/app-core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { SIGN_IN_CALLBACK } from './deep-link';
import { TAURI_PLATFORM } from './platform';

/** An Android emulator's loopback is the emulated device itself; 10.0.2.2 is
 *  the machine it runs on. */
const DEV_API_ORIGIN =
	TAURI_PLATFORM === 'android' ? 'http://10.0.2.2:8020' : 'http://localhost:8020';

/** An ORIGIN, never a path — `@sloppy/client` owns everything after it. No
 *  hosted Sloppy exists yet, so the fallback is the API's own dev default
 *  (`AppConfigService`) and a fresh clone runs with no .env at all. */
const API_HOST = (import.meta.env.PUBLIC_SLOPPY_API_URL || DEV_API_ORIGIN).replace(/\/+$/, '');

export function initNativeRuntime(): void {
	initRuntime({
		apiHost: () => API_HOST,
		onAuthInvalid: () => session.clear(),
		// The return leg is `deep-link.ts`.
		openExternal: (url) => openUrl(url),
		// A webview origin is not an address the system browser can navigate to,
		// so consent comes back over the scheme this app is registered for.
		signInRedirect: () => SIGN_IN_CALLBACK,
		// Nothing in this shell writes a file yet.
		saveFile: null
	});
}
