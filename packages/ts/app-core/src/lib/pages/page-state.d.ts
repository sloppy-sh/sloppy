/**
 * The note the graph is showing over itself. It rides in the history entry
 * rather than in the page's own state so that a back gesture closes it, and
 * `pushState` spells the note's address into the address bar beside it —
 * `routes.ts` owns that spelling.
 */

import type { OwnedRef } from '@sloppy/types';

declare global {
	namespace App {
		interface PageState {
			note?: OwnedRef;
		}
	}
}
