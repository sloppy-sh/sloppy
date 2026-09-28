/**
 * The notes the graph is showing over itself. They ride in the history entry
 * rather than in the page's own state so that a back gesture closes them, and
 * `pushState` spells the active note's address into the address bar beside them
 * — `routes.ts` owns that spelling.
 *
 * A reload keeps only what the address bar carries, which is the active note.
 */

import type { OwnedRef } from '@sloppy/types';

/** A part of a note somebody was sent to: the changes standing offered on it. */
export type NoteLanding = 'offers';

declare global {
	namespace App {
		interface PageState {
			/** The one being read, and the one the address bar names. */
			note?: OwnedRef;
			/** Every note open beside it, this one included, in the order they
			 *  were opened. Absent is the one note in {@link note}, or none. */
			notes?: readonly OwnedRef[];
			/** Where in {@link note} to open. Absent is the top of it, which is
			 *  every way of reaching a note but an act that named a part of one. */
			at?: NoteLanding;
		}
	}
}
