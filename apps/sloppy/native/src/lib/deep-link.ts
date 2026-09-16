/**
 * The return leg of `runtime.openExternal`, and the way a link somebody was
 * sent opens here. Both arrive as a URL whose path is a route in the very same
 * SvelteKit app a browser would have run — so the shell re-enters it and knows
 * nothing about where it leads. `tauri.conf.json` declares what the OS hands
 * over: the `sloppy` scheme, and the note and sign-in-return links on Sloppy's
 * own domain.
 */

import { goto } from '$app/navigation';
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';

/** Where sign-in is told to put somebody down; the API hands a session back
 *  only to a target it recognises. */
export const SIGN_IN_CALLBACK = 'sloppy://auth/callback';

/** Both ways consent comes back: the web page it lands on forwards into the
 *  custom scheme, and on a phone that page is an app link the OS hands over
 *  whole. Either arrives carrying the hand-off and belongs on the root. */
const RETURN_PATHS = new Set(['/auth/callback', '/auth/return']);

type Entry = {
	route: string;
	/** A session is picked up as the app boots and only then, so a return from
	 *  consent re-enters the document rather than going through the router. */
	reenters: boolean;
};

function entryOf(raw: string): Entry | undefined {
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
	const reenters = RETURN_PATHS.has(path);
	return { route: `${reenters ? '/' : path}${url.search}${url.hash}`, reenters };
}

/** `sloppy://n/<did>/<ulid>` and `https://<host>/n/<did>/<ulid>` both →
 *  `/n/<did>/<ulid>`: a custom scheme has no host, so its first path segment is
 *  parsed as one and has to be put back. */
export function routeOf(raw: string): string | undefined {
	return entryOf(raw)?.route;
}

const ENTERED_LINKS = 'sloppy.entered-links';

function entered(): Set<string> {
	return new Set(sessionStorage.getItem(ENTERED_LINKS)?.split('\n'));
}

function markEntered(raw: string): void {
	const all = entered();
	all.add(raw);
	sessionStorage.setItem(ENTERED_LINKS, [...all].join('\n'));
}

function enter(urls: string[]): void {
	for (const raw of urls) {
		const entry = entryOf(raw);
		if (!entry) continue;
		const { route } = entry;
		markEntered(raw);
		if (entry.reenters) {
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

/**
 * What the app was launched with, less what this session has already entered.
 * The OS goes on answering with the same link for the life of the process, and
 * the callback above re-enters the document — so a second read would spend a
 * code that is already spent.
 */
async function unenteredLaunchLinks(): Promise<string[]> {
	const urls = (await getCurrent()) ?? [];
	const already = entered();
	return urls.filter((url) => !already.has(url));
}

export async function forwardDeepLinks(): Promise<void> {
	await onOpenUrl(enter);
	try {
		// A link that launched the app was delivered before anything was listening.
		enter(await unenteredLaunchLinks());
	} catch {
		// A platform with nothing to report costs the cold launch, not the app.
	}
}
