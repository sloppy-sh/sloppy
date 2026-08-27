/**
 * The URL a note is cited by, and its inverse. Both shells mount
 * `/n/[did]/[ulid]` on it, and the graph reads the note it is showing back out
 * of the address bar — so the two spellings have to be one function each.
 */

import type { OwnedRef } from '@sloppy/types';

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
