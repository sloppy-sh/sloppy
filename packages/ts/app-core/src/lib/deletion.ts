// What a person is told before deleting, asked from inside a note and from the
// canvas about a whole chosen set, and how long they have to change their mind.

import { DELETED_KEPT_FOR_DAYS, type NodeView, type OwnedRef } from '@sloppy/types';
import { nodes } from './stores/nodes.svelte.js';

const DAY = 24 * 60 * 60 * 1000;

/** These notes and everything under them. Null where a branch has not been
 *  counted yet, which no number may stand in for. */
function reaches(refs: readonly OwnedRef[]): NodeView[] | null {
	const going = new Map<OwnedRef, NodeView>();
	const walk = (of: OwnedRef) => {
		for (const child of nodes.children(of)) {
			if (going.has(child.ref)) continue;
			going.set(child.ref, child);
			walk(child.ref);
		}
	};
	for (const ref of refs) {
		const note = nodes.get(ref);
		if (!note || !nodes.status({ origin: note.origin }).loaded) return null;
		going.set(ref, note);
		walk(ref);
	}
	return [...going.values()];
}

/** What deleting these notes takes with it, in the words the question shows. */
export function deletionCost(refs: readonly OwnedRef[]): string {
	const one = refs.length === 1;
	const it = one ? 'it' : 'them';
	const going = reaches(refs);
	const grown = going === null ? null : going.length - refs.length;
	const goes = one ? 'It goes' : 'They go';
	const takes =
		grown === null
			? `${goes}, and so does everything written under ${it}.`
			: grown === 0
				? `${goes}.`
				: grown === 1
					? `${goes}, and so does the one note that grew out of ${it}.`
					: `${goes}, and so do the ${grown.toLocaleString()} notes that grew out of ${it}.`;
	const back = `You can put ${it} back from What you deleted for ${DELETED_KEPT_FOR_DAYS} days.`;
	const out = stillOut(refs, going);
	return out === null ? `${takes} ${back}` : `${takes} ${out} ${back}`;
}

/** The half of a delete nothing can take back, where there is one: somebody
 *  reading a published branch keeps whatever they have already pulled. */
function stillOut(refs: readonly OwnedRef[], going: NodeView[] | null): string | null {
	const itself = refs.some((ref) => nodes.get(ref)?.published);
	const anywhere = itself || (going ?? []).some((note) => note.published);
	if (!anywhere) return null;
	if (refs.length > 1) {
		return 'Some of these are published — whoever already has them keeps their copy.';
	}
	return itself
		? 'It is published — whoever already has it keeps their copy.'
		: 'Something under it is published — whoever already has it keeps their copy.';
}

/** How long is left to put a deleted branch back, in the words a listing shows. */
export function timeToPutBack(deletedAt: string, now: number = Date.now()): string {
	const days = Math.ceil((new Date(deletedAt).getTime() + DELETED_KEPT_FOR_DAYS * DAY - now) / DAY);
	if (days <= 1) return 'Today is the last day';
	return `${days.toLocaleString()} days left`;
}
