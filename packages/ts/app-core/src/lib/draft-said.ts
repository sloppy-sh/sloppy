/**
 * What a draft of the notes reads as: how much is in it before somebody opens
 * it, and one row per note once they have — DESIGN.md § "Reading a draft".
 *
 * A row is drawn with the same card the chat drew as the act happened, so the
 * review and the thread say one thing in one set of words.
 */

import {
	A_NOTE,
	CARD_NONE,
	CARD_ROWS,
	cardRow,
	chatCard,
	type ChatCard,
	type ChatCardRow,
	type ImportConflict,
	type OwnedRef
} from '@sloppy/types';
import type { DifferenceCounts, VaultDifference } from '@sloppy/vault';

/** A note as a row cites it: the number somebody navigates by, and what it is
 *  called. */
export interface DraftNote {
	title: string;
	address?: string;
}

/**
 * Which band a note's row stands in. The order here is the order they are
 * read in and no other, so a surface iterates this rather than choosing.
 */
export const DRAFT_BANDS = ['settle', 'added', 'changed', 'moved', 'removed'] as const;
export type DraftBand = (typeof DRAFT_BANDS)[number];

export const DRAFT_BAND_HEADINGS: Record<DraftBand, string> = {
	settle: 'To settle first',
	added: 'New',
	changed: 'Written into',
	moved: 'Moved',
	removed: 'In the bin'
};

/** One note, once. A note written into and moved says both here rather than
 *  standing in the list twice. */
export interface DraftRow {
	ref: OwnedRef;
	band: DraftBand;
	card: ChatCard;
}

const WAS_UNDER = 'Was under';
const WAS_NUMBERED = 'Was';
const WAS_CALLED = 'Was called';
const SECTIONS = CARD_ROWS.sections;
const NOTHING_UNDER = 'Nothing';

/** A note as somebody cites it, for a heading. */
export function draftHeading(note: DraftNote | undefined): string {
	if (!note) return A_NOTE;
	const title = note.title.trim();
	if (note.address === undefined) return title === '' ? A_NOTE : title;
	return title === '' ? note.address : `${note.address} · ${title}`;
}

/**
 * Every note the draft says something different about, in reading order. A
 * note that is in more than one of a difference's lists takes the first band
 * it belongs to and carries the rest of what happened in its rows.
 */
export function draftRows(
	difference: VaultDifference,
	conflicts: readonly ImportConflict[],
	named: ReadonlyMap<OwnedRef, DraftNote>
): DraftRow[] {
	const { notes } = difference;
	const settling = new Set(conflicts.map((one) => one.ref));
	const added = new Set(notes.added);
	const removed = new Set(notes.removed);
	const changed = new Map(notes.changed.map((one) => [one.ref, one.sections]));
	const moved = new Map(notes.moved.map((one) => [one.ref, one]));
	const renumbered = new Map(notes.renumbered.map((one) => [one.ref, one]));
	const retitled = new Map(notes.retitled.map((one) => [one.ref, one]));
	const cite = (ref: OwnedRef | undefined, otherwise: string): string =>
		ref === undefined ? otherwise : draftHeading(named.get(ref));

	const band = (ref: OwnedRef): DraftBand | null => {
		if (settling.has(ref)) return 'settle';
		if (added.has(ref)) return 'added';
		if (changed.has(ref)) return 'changed';
		if (moved.has(ref) || renumbered.has(ref) || retitled.has(ref)) return 'moved';
		if (removed.has(ref)) return 'removed';
		return null;
	};

	const every = [
		...settling,
		...notes.added,
		...notes.changed.map((one) => one.ref),
		...notes.moved.map((one) => one.ref),
		...notes.renumbered.map((one) => one.ref),
		...notes.retitled.map((one) => one.ref),
		...notes.removed
	];

	const rows: DraftRow[] = [];
	const drawn = new Set<OwnedRef>();
	for (const ref of every) {
		if (drawn.has(ref)) continue;
		const stands = band(ref);
		if (stands === null) continue;
		drawn.add(ref);
		const sections = changed.get(ref);
		const move = moved.get(ref);
		const number = renumbered.get(ref);
		const title = retitled.get(ref);
		const lines: ChatCardRow[] = [
			...cardRow(SECTIONS, sections === undefined ? undefined : sectionsSaid(sections)),
			...(move === undefined
				? []
				: [
						...cardRow(CARD_ROWS.under, cite(move.to, NOTHING_UNDER)),
						...cardRow(WAS_UNDER, cite(move.from, NOTHING_UNDER))
					]),
			...(number === undefined
				? []
				: [
						...cardRow(CARD_ROWS.number, number.to ?? CARD_NONE),
						...cardRow(WAS_NUMBERED, number.from ?? CARD_NONE)
					]),
			...cardRow(WAS_CALLED, title?.from)
		];
		rows.push({ ref, band: stands, card: chatCard('note', draftHeading(named.get(ref)), lines) });
	}
	return rows;
}

/** What a note's sections say happened, in one line. */
function sectionsSaid(sections: VaultDifference['notes']['changed'][number]['sections']): string {
	const said = [
		...counted(sections.changed.length, 'written into'),
		...counted(sections.added.length, 'new'),
		...counted(sections.removed.length, 'taken out')
	];
	if (sections.reordered) said.push('put in another order');
	return said.join(', ');
}

function counted(many: number, one: string, more = one): string[] {
	if (many === 0) return [];
	return [`${many.toLocaleString()} ${many === 1 ? one : more}`];
}

/** The pictures a draft brought or took away, in one line. `null` is a draft
 *  that touched none. */
export function picturesSaid(counts: DifferenceCounts): string | null {
	const said = [
		...counted(counts.media.added, 'picture arrived', 'pictures arrived'),
		...counted(counts.media.removed, 'picture went', 'pictures went')
	];
	return said.length === 0 ? null : `${said.join(', ')}.`;
}

/**
 * How much a draft holds, for the line at the head of the chat. A note in two
 * of these is one note two things happened to, and both are said: somebody
 * deciding whether to read it wants what was done, not a total.
 */
export function draftHolds(counts: DifferenceCounts): string {
	const { notes, media } = counts;
	const said = [
		...counted(notes.added, 'new note', 'new notes'),
		...counted(notes.changed, 'written into'),
		...counted(notes.moved, 'moved'),
		...counted(notes.renumbered, 'renumbered'),
		...counted(notes.retitled, 'renamed'),
		...counted(notes.removed, 'in the bin'),
		...counted(media.added + media.removed, 'picture', 'pictures')
	];
	return said.join(', ');
}

/** What one note two copies disagree about is asked as. */
export function settlingSaid(conflict: ImportConflict): string {
	if (conflict.kind === 'address') {
		return 'Both carry this number, on a different note. Choose which note keeps it.';
	}
	if (conflict.kind === 'section') {
		return 'You and the draft wrote into the same sections of this note. Choose what it says.';
	}
	return 'You and the draft both wrote in this note. Choose what it says.';
}

/** A note named among the ones a conflict is about, for its heading. */
export function conflictHeading(
	conflict: ImportConflict,
	named: ReadonlyMap<OwnedRef, DraftNote>
): string {
	const note = named.get(conflict.ref);
	if (note) return draftHeading(note);
	return conflict.address ?? A_NOTE;
}
