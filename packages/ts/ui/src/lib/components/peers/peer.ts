// What the follow-and-pull surfaces are handed. The host owns every request;
// nothing here reaches a server.

import type {
	Address,
	OwnedRef,
	PublishedPublication,
	PublishedVersion,
	Timestamp
} from '@sloppy/types';
import type { Person } from '../identity/person.js';

/** Somebody a surface names. `person` is absent where nobody here could resolve
 *  them, and the identity they were followed by stands in. */
export interface Peer {
	identity: string;
	person: Person | null;
	/** True where their instance answered with nobody, so no name is coming and
	 *  the identifier stands in for good. */
	unplaced?: boolean;
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
	/** The version of it the reader holds. */
	version: PublishedVersion;
	/** When the copy was last read from its author. */
	readAt: Timestamp;
	/** Which of the author's notebooks the addresses in it are read in, as a key
	 *  and never a label. Absent is their home notebook. */
	graph?: OwnedRef;
	/** What the author calls that notebook, where the name travelled with it. */
	notebook?: string;
	/** Where it was read from, as the reader named it. */
	from: string;
}

/** What one identity publishes on one instance, as far as a surface has read. */
export interface PublishedThere {
	/** Whose these are, as the identifier everything else holds: what was typed
	 *  may have been the name they are known by. */
	identity: string;
	publications: readonly PublishedPublication[];
	/** More to ask for; absent is the end of the listing. */
	nextCursor?: string;
}

/** One of the reader's own notes somebody answered. */
export interface Answered {
	note: OwnedRef;
	/** Absent on a note its author gave none; the title names it. */
	address?: Address;
	title: string;
	/** The notebook the address is read in, as a key. */
	graph: OwnedRef;
	/** What the reader calls it, where they named it. */
	notebook?: string;
	/** Who answered, in the order the answers arrived. */
	voices: readonly Peer[];
}
