// A note's sections, read and written under its row in the outline, and where
// carrying one by its handle lands — its own note, another note's stack, a note
// row, or the run between two rows.

import { noteLabel, type OwnedRef } from '@sloppy/types';
import { INDENT_PX, type TreeBox } from './tree-drag.js';
import type { TreeRow } from './walk.js';

/** One section, as the outline's handle for it says it. */
export interface TreeSection {
	ref: OwnedRef;
	/** Its first line, or a name for what it holds where it has no words. */
	says: string;
}

/** What stands under a note besides its sections — that they are being read,
 *  that nothing is written in it, or why an act on it did not land. Empty says
 *  nothing. */
export interface SectionSays {
	says: string;
	/** True where reading the note again is what to do about it, which is the
	 *  only state the row answers a tap in. */
	again: boolean;
}

/** One line under a note that has nothing to draw for it yet, or something to
 *  say beside what it is drawing. */
export interface SectionWord extends SectionSays {
	kind: 'says';
	note: OwnedRef;
	depth: number;
}

export type OutlineRow = TreeRow | SectionWord;

/** Carrying a section out of the note it was written in. Absent leaves every
 *  section in its own note, which is all a walk of somebody else's notes has. */
export interface SectionCarries {
	/** Into `note`'s stack, following `after` — null puts it first. */
	into: (section: OwnedRef, note: OwnedRef, after: OwnedRef | null) => void;
	/** Onto a note whose sections are not drawn, at the end of its stack. */
	onto: (section: OwnedRef, note: OwnedRef) => void;
	/** Out of every note: a note of its own, springing from the run `on` names,
	 *  with the section as the only thing written in it. */
	out: (section: OwnedRef, on: OwnedRef, relation: 'under' | 'after') => void;
}

/** What the outline is given to draw a note's interior from. */
export interface OutlineSections {
	/** The notes whose sections are drawn. */
	shown: ReadonlySet<OwnedRef>;
	/** A note's sections in stack order, or nothing where none are in hand yet. */
	of: (note: OwnedRef) => readonly TreeSection[] | undefined;
	says: (note: OwnedRef) => SectionSays;
	onShow: (note: OwnedRef, show: boolean) => void;
	/** `after` is the section this one is to follow; null puts it first. */
	onMove: (note: OwnedRef, section: OwnedRef, after: OwnedRef | null) => void;
	onCarry?: SectionCarries;
}

/** The walk's rows, with a word set under each shown note that has one. */
export function withSections(
	rows: readonly TreeRow[],
	held: Pick<OutlineSections, 'shown' | 'says'>
): OutlineRow[] {
	const out: OutlineRow[] = [];
	for (const row of rows) {
		out.push(row);
		if (row.kind !== 'note' || !held.shown.has(row.note.ref)) continue;
		const word = held.says(row.note.ref);
		if (word.says !== '') {
			out.push({ kind: 'says', note: row.note.ref, ...word, depth: row.depth + 1 });
		}
	}
	return out;
}

/** One note's interior as a drag reads it off the page, in viewport
 *  coordinates: the bounds a drop lands in that note's stack, and where each of
 *  its sections stands inside them. */
export interface SectionBand {
	note: OwnedRef;
	named: string;
	top: number;
	bottom: number;
	rows: readonly { ref: OwnedRef; says: string; top: number; bottom: number }[];
}

/** Which gap in a note's stack a drop would land in, counted from 0 above the
 *  first section. */
export interface SectionAim {
	slot: number;
}

/** Where a drag down `y` is aiming within one note's interior; null anywhere
 *  outside it. */
export function aimSection(band: SectionBand, y: number): SectionAim | null {
	if (y < band.top || y > band.bottom) return null;
	for (const [at, row] of band.rows.entries()) {
		if (y < (row.top + row.bottom) / 2) return { slot: at };
	}
	return { slot: band.rows.length };
}

/** Where letting a carried section go would put it. */
export type SectionLanding =
	| { kind: 'stack'; note: OwnedRef; named: string; slot: number; after: OwnedRef | null }
	| { kind: 'onto'; note: OwnedRef; named: string }
	| { kind: 'note'; on: OwnedRef; named: string; relation: 'under' | 'after' };

/** How much of a note row, at each end, is the run between the rows rather than
 *  the row itself. */
const EDGE = 0.25;

/**
 * Where a section carried over the outline is aiming. A note whose sections are
 * drawn takes the drop into its stack; the middle of any other row takes it into
 * that note; either end of a row is the run around it, where the section becomes
 * a note of its own — `under` the row where the pointer is set in past its
 * words, and `after` it otherwise, exactly as a note carried here reads.
 */
export function aimCarry(
	bands: readonly SectionBand[],
	boxes: readonly TreeBox[],
	x: number,
	y: number,
	indent = INDENT_PX
): SectionLanding | null {
	const band = bands.find((one) => y >= one.top && y <= one.bottom);
	if (band) {
		const aim = aimSection(band, y);
		if (!aim) return null;
		return {
			kind: 'stack',
			note: band.note,
			named: band.named,
			slot: aim.slot,
			after: aim.slot === 0 ? null : (band.rows[aim.slot - 1]?.ref ?? null)
		};
	}
	if (boxes.length === 0 || y < boxes[0].top) return null;
	const box = boxes.find((one) => y < one.bottom) ?? boxes[boxes.length - 1];
	const edge = (box.bottom - box.top) * EDGE;
	const named = noteLabel(box);
	if (y > box.top + edge && y < box.bottom - edge) return { kind: 'onto', note: box.on, named };
	return {
		kind: 'note',
		on: box.on,
		named,
		relation: x >= box.left + indent ? 'under' : 'after'
	};
}

const PLACES = [
	'first',
	'second',
	'third',
	'fourth',
	'fifth',
	'sixth',
	'seventh',
	'eighth',
	'ninth',
	'tenth'
];

/** Where in a stack a slot is, as somebody reads it. */
function placed(slot: number): string {
	if (slot === 0) return 'first';
	const word = PLACES[slot - 1];
	return word ? `after the ${word} section` : `after section ${slot}`;
}

/** What letting go would do, for the reader and for anyone listening. `own` is
 *  the note the section is being carried out of. */
export function carrySays(
	landing: SectionLanding | null,
	own: { note: OwnedRef; named: string },
	bands: readonly SectionBand[]
): string {
	if (!landing) return 'Move it over a note, or between two, to put it there';
	if (landing.kind === 'onto') {
		return landing.note === own.note ? 'Stays where it is' : `Onto ${landing.named}, at the end`;
	}
	if (landing.kind === 'note') {
		return `Becomes a note ${landing.relation === 'under' ? 'under' : 'beside'} ${landing.named}`;
	}
	if (landing.note !== own.note) return `Into ${landing.named}, ${placed(landing.slot)}`;
	const above = bands.find((one) => one.note === own.note)?.rows[landing.slot - 1];
	return above ? `Put it after ${above.says}` : `Put it first in ${own.named}`;
}

/**
 * The section a moved one then follows — null where it goes first — for a drop
 * in the gap `slot`. Null altogether where it has not moved: the two gaps a
 * section already touches leave the stack as it stands.
 */
export function landingAt(
	sections: readonly TreeSection[],
	ref: OwnedRef,
	slot: number
): { after: OwnedRef | null } | null {
	const from = sections.findIndex((one) => one.ref === ref);
	if (from < 0 || slot < 0 || slot > sections.length) return null;
	if (slot === from || slot === from + 1) return null;
	const at = slot < from ? slot : slot - 1;
	const rest = sections.filter((one) => one.ref !== ref);
	return { after: at === 0 ? null : rest[at - 1].ref };
}

/** The same, for a section asked to go one place up or down its note's stack. */
export function landingBy(
	sections: readonly TreeSection[],
	ref: OwnedRef,
	step: number
): { after: OwnedRef | null } | null {
	const from = sections.findIndex((one) => one.ref === ref);
	if (from < 0) return null;
	const slot = Math.max(0, Math.min(sections.length, from + (step < 0 ? -1 : 2)));
	return landingAt(sections, ref, slot);
}
