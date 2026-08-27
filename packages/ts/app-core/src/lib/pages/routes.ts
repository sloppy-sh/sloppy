/**
 * Where the app's pages live, and the URL a note is cited by. Both shells mount
 * their route tree on this list and on `nodeHref`, so a page exists in one
 * place and the two surfaces cannot drift apart.
 */

import Network from '@lucide/svelte/icons/network';
import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
import Tags from '@lucide/svelte/icons/tags';
import UserRound from '@lucide/svelte/icons/user-round';
import type { OwnedRef } from '@sloppy/types';
import type { NavItem, Person } from '@sloppy/ui';

/** In the order they are shown. `id` is what {@link activeRouteId} answers. */
export const APP_ROUTES: NavItem[] = [
	{ id: 'graph', label: 'Graph', href: '/', icon: Network },
	{ id: 'labels', label: 'Labels', href: '/labels', icon: Tags },
	{ id: 'profile', label: 'You', href: '/profile', icon: UserRound },
	{ id: 'settings', label: 'Settings', href: '/settings', icon: SlidersHorizontal }
];

/** The same destinations, with the signed-in person standing on their own. */
export function navRoutes(person: Person | null): NavItem[] {
	if (!person) return APP_ROUTES;
	return APP_ROUTES.map((route) => (route.id === 'profile' ? { ...route, person } : route));
}

/** Reachable with no account — DESIGN.md § Persistence, on appearance. */
export const OPEN_ROUTES = ['/sign-in', '/settings'];

/** The graph is the fallback because every note sits on it. */
export function activeRouteId(path: string): string {
	const match = APP_ROUTES.filter((route) => route.href !== '/').find(
		(route) => path === route.href || path.startsWith(`${route.href}/`)
	);
	return match?.id ?? 'graph';
}

export function nodeHref(ref: OwnedRef): string {
	const cut = ref.lastIndexOf('/');
	return `/n/${encodeURIComponent(ref.slice(0, cut))}/${encodeURIComponent(ref.slice(cut + 1))}`;
}

/** `null` for any path that does not name a note. */
export function refFromPath(path: string): OwnedRef | null {
	const parts = path.split('/');
	if (parts.length !== 4 || parts[1] !== 'n') return null;
	const did = decodeURIComponent(parts[2]);
	const ulid = decodeURIComponent(parts[3]);
	return did && ulid ? (`${did}/${ulid}` as OwnedRef) : null;
}
