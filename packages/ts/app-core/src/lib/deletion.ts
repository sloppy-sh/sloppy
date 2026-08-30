// What a person is told before the one act that cannot be taken back, asked
// from inside a note and from the canvas about a whole chosen set.

import type { OwnedRef } from '@sloppy/types';
import { nodes } from './stores/nodes.svelte.js';

/** Everything under these notes that is not itself one of them. Null where a
 *  branch has not been counted yet, which no number may stand in for. */
function grownFrom(refs: readonly OwnedRef[]): number | null {
	const going = new Set(refs);
	const walk = (of: OwnedRef) => {
		for (const child of nodes.children(of)) {
			going.add(child.ref);
			walk(child.ref);
		}
	};
	for (const ref of refs) {
		const note = nodes.get(ref);
		if (!note || !nodes.status({ origin: note.origin }).loaded) return null;
		walk(ref);
	}
	return going.size - refs.length;
}

/** What deleting these notes takes with it, in the words the question shows. */
export function deletionCost(refs: readonly OwnedRef[]): string {
	const one = refs.length === 1;
	const it = one ? 'it' : 'them';
	const grown = grownFrom(refs);
	if (grown === null) {
		return one
			? 'It goes for good, and so does everything written under it.'
			: 'They go for good, and so does everything written under them.';
	}
	const goes = one ? 'It goes for good' : 'They go for good';
	if (grown === 0) return `${goes}.`;
	if (grown === 1) return `${goes}, and so does the one note that grew out of ${it}.`;
	return `${goes}, and so do the ${grown.toLocaleString()} notes that grew out of ${it}.`;
}
