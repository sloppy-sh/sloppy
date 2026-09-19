/**
 * The platform seam as a surface reads it — `runtime.ts` is the seam itself.
 *
 * `runtime` is plain module state that no rune watches, so a shell that settles
 * it again while the app is running says {@link seamSettledAgain} and every
 * answer read through {@link seam} is read again where a page is holding one.
 */

import { runtime } from './runtime.js';

let settlings = $state(0);

export function seam(): typeof runtime {
	void settlings;
	return runtime;
}

/** Say the seam now serves the app from somewhere else — after `updateRuntime`,
 *  and after whatever is read against it has settled. */
export function seamSettledAgain(): void {
	settlings += 1;
}
