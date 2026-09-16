/**
 * This shell's half of `IdentityAccess` in `@sloppy/local`, which declares every
 * act and what its answer means. What is here is only what a native process can
 * do and a tab cannot: reach an identity store that answers no webview, and open
 * the system browser for the one page a webview must not host.
 */

import { Identities, type Files, type IdentitiesOptions, type IdentityAccess } from '@sloppy/local';
import { fetch as reachOut } from '@tauri-apps/plugin-http';
import { openUrl } from '@tauri-apps/plugin-opener';

export function tauriIdentities(
	files: Files,
	options: Pick<IdentitiesOptions, 'origin' | 'graphOwner' | 'changed'>
): IdentityAccess {
	return new Identities(files, {
		...options,
		fetching: (url, init) => reachOut(url, init),
		leave: (url) => openUrl(url)
	});
}
