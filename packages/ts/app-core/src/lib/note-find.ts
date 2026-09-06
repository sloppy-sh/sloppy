// Reaching a note again by what somebody remembers of it. Every surface that
// offers a note to type at matches by the one rule here, so a note reachable
// from the link sheet is reachable from anywhere else that asks.

import type { NodeView } from '@sloppy/types';
import { graphs } from './stores/graphs.svelte.js';
import { nodes } from './stores/nodes.svelte.js';

/** How a note is reached by what a person cites: the address, or words in the
 *  title. `needle` is already lowercased. */
export function carries(note: NodeView, needle: string): boolean {
	return note.address.startsWith(needle) || note.title.toLowerCase().includes(needle);
}

/** How much of what a person keeps a match was made against. Only at `whole`
 *  may a surface say there is no such note. */
export type Reach = 'whole' | 'short';

/**
 * Read every graph this person keeps, so what {@link carries} is asked about is
 * all of them. One graph that will not read must not cost the others theirs, so
 * this answers `short` rather than throwing.
 */
export async function reachEveryGraph(): Promise<Reach> {
	let whole = true;
	const kept = await graphs.load().catch(() => {
		whole = false;
		return [];
	});
	await Promise.all(
		kept.map(async ({ ref: graph }) => {
			try {
				const branches = await nodes.load({ graph });
				await Promise.all(branches.map((root) => nodes.load({ origin: root.ref })));
			} catch {
				whole = false;
			}
		})
	);
	return whole ? 'whole' : 'short';
}
