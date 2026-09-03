// What the follow-and-pull surfaces are handed. The host owns every request;
// nothing here reaches a server.

import type { Address, OwnedRef, PublishedPublication } from '@sloppy/types';
import type { Person } from '../identity/person.js';

/** Somebody a surface names. `person` is absent where nobody here could resolve
 *  them, and the identity they were followed by stands in. */
export interface Peer {
	identity: string;
	person: Person | null;
	/** The instance to ask about them, where the host knows one. Absent is this
	 *  one, which is the whole of it for somebody whose graph is kept here. */
	from?: string;
}

/** A region of somebody else's graph the reader holds. */
export interface HeldRegion extends Peer {
	ref: OwnedRef;
	/** The publication it is a copy of, which is what a second copy of it would
	 *  refresh rather than grow beside. */
	publication: OwnedRef;
	/** The address the region is rooted at, which is what a peer cites. */
	address: Address;
	/** Where it was read from, as the reader named it. */
	from: string;
}

/** What one identity publishes on one instance, as far as a surface has read. */
export interface PublishedThere {
	publications: readonly PublishedPublication[];
	/** More to ask for; absent is the end of the listing. */
	nextCursor?: string;
}
