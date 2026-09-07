/**
 * The return leg of `runtime.openExternal`, and the way a link somebody was
 * sent opens here. Both arrive as a URL whose path is a route in the very same
 * SvelteKit app a browser would have run — so the shell re-enters it and knows
 * nothing about where it leads. `tauri.conf.json` declares what the OS hands
 * over: the `sloppy` scheme, and the notes on Sloppy's own domain.
 */

import { goto } from '$app/navigation';
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';

/** Where sign-in is told to put somebody down; the API hands a session back
 *  only to a target it recognises. */
export const SIGN_IN_CALLBACK = 'sloppy://auth/callback';

const CALLBACK_ROUTE = '/auth/callback';

/** `sloppy://n/<did>/<ulid>` and `https://<host>/n/<did>/<ulid>` both →
 *  `/n/<did>/<ulid>`: a custom scheme has no host, so its first path segment is
 *  parsed as one and has to be put back. */
export function routeOf(raw: string): string | undefined {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return undefined;
	}
	const web = url.protocol === 'https:' || url.protocol === 'http:';
	const path = (web ? url.pathname : `/${url.host}${url.pathname}`)
		.replace(/\/{2,}/g, '/')
		.replace(/(.)\/+$/, '$1');
	const route = path === CALLBACK_ROUTE ? '/' : path;
	return `${route}${url.search}${url.hash}`;
}

function enter(urls: string[]): void {
	for (const raw of urls) {
		const route = routeOf(raw);
		if (!route) continue;
		// A session is opened as the app boots and only then, so consent re-enters
		// the document rather than the router.
		if (raw.startsWith(SIGN_IN_CALLBACK)) {
			location.assign(route);
		} else {
			// `resolve()` takes a route id known at build time; this one arrives from
			// the OS. The shell is served from the bundle root, so there is no base
			// path for it to prepend either.
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			void goto(route);
		}
		return;
	}
}

const LAUNCH_LINK = 'sloppy.launch-link';

/**
 * What the app was launched with, the once. The OS goes on answering with the
 * same link for as long as the app runs, and the callback above re-enters the
 * document — so reading it a second time would spend a code already spent.
 */
export async function launchLinks(): Promise<string[]> {
	const urls = (await getCurrent()) ?? [];
	const key = urls.join('\n');
	if (!key || sessionStorage.getItem(LAUNCH_LINK) === key) return [];
	sessionStorage.setItem(LAUNCH_LINK, key);
	return urls;
}

export async function forwardDeepLinks(): Promise<void> {
	await onOpenUrl(enter);
	try {
		// A link that launched the app was delivered before anything was listening.
		enter(await launchLinks());
	} catch {
		// A platform with nothing to report costs the cold launch, not the app.
	}
}
