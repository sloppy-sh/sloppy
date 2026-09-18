// The looks on the lines between the notes in front of a reader, resolved off
// both ends — docs/ARCHITECTURE.md § "A look a person set on a line".

import { lookBetween, type EdgeLook, type NodeView } from '@sloppy/types';
import { edgeLookKey, type GraphEdgeLook } from '@sloppy/graph';

/**
 * One look per pair among these notes, oriented: `from` is the note it is
 * stored on and `to` the note at the other end, which is what `direction` is
 * read against. A look naming a note that is not here is left out — there is no
 * line on this canvas for it to be on.
 */
export function looksOnCanvas(notes: readonly NodeView[]): GraphEdgeLook[] {
	const byRef = new Map(notes.map((note) => [note.ref, note]));
	const drawn = new Map<string, GraphEdgeLook>();
	for (const note of notes) {
		for (const look of note.edges ?? []) {
			const other = byRef.get(look.to);
			if (!other || other.ref === note.ref) continue;
			const key = edgeLookKey(note.ref, other.ref);
			if (drawn.has(key)) continue;
			const won = lookBetween(note, other);
			if (!won) continue;
			drawn.set(key, {
				from: won.to === other.ref ? note.ref : other.ref,
				...won
			});
		}
	}
	return [...drawn.values()];
}

/** The line between two notes, as the edge sheet reads it. */
export interface LineBetween {
	/** The note the look is written on: the end that already carries one, and
	 *  otherwise the note the reader came from. */
	on: NodeView;
	other: NodeView;
	/** What the pair is drawn under now, absent where nobody has set a look. */
	look?: EdgeLook;
}

/**
 * Which note a look set on this pair is written on, and what it carries today.
 * The app writes one note and never the other end's — so where the other end is
 * the one holding the pair's look, editing it is editing that note.
 */
export function lineBetween(from: NodeView, to: NodeView): LineBetween {
	const won = lookBetween(from, to);
	const on = won === undefined || won.to === to.ref ? from : to;
	const other = on === from ? to : from;
	return { on, other, ...(won === undefined ? {} : { look: won }) };
}
