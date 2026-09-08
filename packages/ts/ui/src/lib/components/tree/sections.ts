// A note's sections drawn under its row in the outline, and the arranging of
// them there.

import { noteLabel, type OwnedRef } from '@sloppy/types';
import type { TreeRow } from './walk.js';

/** One section, as a row of the outline says it. */
export interface TreeSection {
	ref: OwnedRef;
	/** Its first line, or a name for what it holds where it has no words. */
	says: string;
}

export interface SectionItem {
	kind: 'section';
	/** The note it belongs to, and what names it — `noteLabel` in
	 *  `@sloppy/types`, so a note with no address is named by its title. */
	note: OwnedRef;
	named: string;
	section: TreeSection;
	depth: number;
	/** Its place in the note's stack, from 1, and how long that stack is. */
	at: number;
	of: number;
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

/** One line under a note that has no section rows to draw, or something to say
 *  beside the ones it has. */
export interface SectionWord extends SectionSays {
	kind: 'says';
	note: OwnedRef;
	depth: number;
}

export type OutlineRow = TreeRow | SectionItem | SectionWord;

/** What the outline is given to draw a note's sections from. */
export interface OutlineSections {
	/** The notes whose sections are drawn. */
	shown: ReadonlySet<OwnedRef>;
	/** A note's sections in stack order, or nothing where none are in hand yet. */
	of: (note: OwnedRef) => readonly TreeSection[] | undefined;
	says: (note: OwnedRef) => SectionSays;
	onShow: (note: OwnedRef, show: boolean) => void;
	/** `after` is the section this one is to follow; null puts it first. */
	onMove: (note: OwnedRef, section: OwnedRef, after: OwnedRef | null) => void;
}

/** The walk's rows with each shown note's sections set in under it. */
export function withSections(
	rows: readonly TreeRow[],
	held: Pick<OutlineSections, 'shown' | 'of' | 'says'>
): OutlineRow[] {
	const out: OutlineRow[] = [];
	for (const row of rows) {
		out.push(row);
		if (row.kind !== 'note' || !held.shown.has(row.note.ref)) continue;
		const depth = row.depth + 1;
		const stack = held.of(row.note.ref) ?? [];
		stack.forEach((section, at) => {
			out.push({
				kind: 'section',
				note: row.note.ref,
				named: noteLabel(row.note),
				section,
				depth,
				at: at + 1,
				of: stack.length
			});
		});
		const word = held.says(row.note.ref);
		if (word.says !== '') out.push({ kind: 'says', note: row.note.ref, ...word, depth });
	}
	return out;
}

/** One note's section rows as a drag reads them off the page, in viewport
 *  coordinates, with the top of the note's own row above them. */
export interface SectionBand {
	top: number;
	rows: readonly { ref: OwnedRef; says: string; top: number; bottom: number }[];
}

/** Which gap in a note's stack a drop would land in, counted from 0 above the
 *  first section. */
export interface SectionAim {
	slot: number;
}

/**
 * Where a drag over `y` is aiming. Null anywhere outside the note's own rows: a
 * section belongs to the note it was written in, so there is nowhere else for
 * one to go.
 */
export function aimSection(band: SectionBand, y: number): SectionAim | null {
	const last = band.rows[band.rows.length - 1];
	if (!last || y < band.top || y > last.bottom) return null;
	for (const [at, row] of band.rows.entries()) {
		if (y < (row.top + row.bottom) / 2) return { slot: at };
	}
	return { slot: band.rows.length };
}

/** What the drop is about to do, for the reader and for anyone listening. */
export function sectionSays(band: SectionBand, named: string, aim: SectionAim | null): string {
	if (!aim) return 'A section stays in the note it was written in';
	const above = band.rows[aim.slot - 1];
	return above ? `Put it after ${above.says}` : `Put it first in ${named}`;
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
