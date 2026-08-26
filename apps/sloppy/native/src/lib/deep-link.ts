/**
 * The return leg of `runtime.openExternal`. The system browser hands back a
 * `sloppy://` URL (the scheme is registered in `tauri.conf.json`), and what
 * follows the scheme is a route in the very same SvelteKit app the browser
 * runs — so the shell re-enters it and knows nothing about where it leads.
 */

import { goto } from '$app/navigation';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';

/** `sloppy://auth/callback?x=1` → `/auth/callback?x=1`. The authority is the
 *  first path segment: a custom scheme has no host to strip. */
function routeOf(raw: string): string | undefined {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return undefined;
	}
	const path = `/${url.host}${url.pathname}`.replace(/\/{2,}/g, '/');
	return `${path}${url.search}${url.hash}`;
}

export async function forwardDeepLinks(): Promise<void> {
	await onOpenUrl((urls) => {
		for (const raw of urls) {
			const route = routeOf(raw);
			if (route) {
				// `resolve()` takes a route id known at build time; this one arrives
				// from the OS. The shell is served from the bundle root, so there is
				// no base path for it to prepend either.
				// eslint-disable-next-line svelte/no-navigation-without-resolve
				void goto(route);
				return;
			}
		}
	});
}
