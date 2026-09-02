// What the follow-and-pull surfaces are handed. The host owns every request;
// nothing here reaches a server.

import type { Address, OwnedRef, PublishedRoot } from '@sloppy/types';
import type { Person } from '../identity/person.js';

/** Somebody a surface names. `person` is absent where nobody here could resolve
 *  them, and the identity they were followed by stands in. */
export interface Peer {
	identity: string;
	person: Person | null;
}

/** A region of somebody else's graph the reader holds. */
export interface HeldRegion extends Peer {
	ref: OwnedRef;
	/** The address the region is rooted at, which is what a peer cites. */
	address: Address;
	/** Where it was read from, as the reader named it. */
	from: string;
}

/** What one identity publishes on one instance, as far as a surface has read. */
export interface PublishedThere {
	roots: readonly PublishedRoot[];
	/** More to ask for; absent is the end of the listing. */
	nextCursor?: string;
}
