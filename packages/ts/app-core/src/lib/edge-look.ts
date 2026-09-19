// The looks on the lines between the notes in front of a reader, resolved off
// both ends — docs/ARCHITECTURE.md § "A look a person set on a line".

import {
	lookBetween,
	writeOutcome,
	type DidSyr,
	type EdgeLook,
	type NodeView
} from '@sloppy/types';
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
	/** The note the look is written on, always one this person's writing lands
	 *  on. */
	on: NodeView;
	other: NodeView;
	/** What the pair is drawn under now, absent where nobody has set a look. */
	look?: EdgeLook;
}

/**
 * Which note a look set on this pair is written on, and what it carries today.
 * The end already carrying the pair's look, so editing a line edits the look it
 * is drawn under and clearing it clears that one — but never a note this
 * person's writing would not land on, which is what keeps them writing their
 * own note and nobody else's.
 */
export function lineBetween(from: NodeView, to: NodeView, writer: DidSyr): LineBetween {
	const won = lookBetween(from, to);
	const carries = won !== undefined && won.to === from.ref ? to : from;
	const lands = (note: NodeView) => writeOutcome(note, writer) === 'lands';
	const on = [carries, from, to].find(lands) ?? from;
	const other = on === from ? to : from;
	return { on, other, ...(won === undefined ? {} : { look: won }) };
}
