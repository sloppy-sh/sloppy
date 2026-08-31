/**
 * The notes the graph is showing over itself. They ride in the history entry
 * rather than in the page's own state so that a back gesture closes them, and
 * `pushState` spells the active note's address into the address bar beside them
 * — `routes.ts` owns that spelling.
 *
 * A reload keeps only what the address bar carries, which is the active note.
 */

import type { OwnedRef } from '@sloppy/types';

declare global {
	namespace App {
		interface PageState {
			/** The one being read, and the one the address bar names. */
			note?: OwnedRef;
			/** Every note open beside it, this one included, in the order they
			 *  were opened. Absent is the one note in {@link note}, or none. */
			notes?: readonly OwnedRef[];
		}
	}
}
