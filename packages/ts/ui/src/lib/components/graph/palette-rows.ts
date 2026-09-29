// Which rows the palette offers for what was typed, in the order a person
// reads them — DESIGN.md § Layout, the field that reaches both a note and an
// act.

import type { OwnedRef } from '@sloppy/types';
import type { FoundNote } from './palette.svelte';

/** One thing the page can do, as the palette offers it. */
export interface PaletteAct {
	/** Stable across draws; what running it is asked by. */
	id: string;
	label: string;
	/** The keystroke that does the same, spelled for the keyboard in front of
	 *  the reader. */
	says?: string;
	/** What it is grouped under when nothing has been typed. */
	group: string;
}

export type PaletteRow =
	| { kind: 'act'; key: string; act: PaletteAct }
	| { kind: 'note'; key: string; note: FoundNote };

function words(said: string): string[] {
	return said.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Whether the typed words begin the label's words, in order — "ch no" reaches
 *  "Choose notes"; "notes" reaches it too, as a word begun. */
export function reaches(label: string, needle: string): boolean {
	const typed = words(needle);
	if (typed.length === 0) return true;
	const own = words(label);
	return typed.every((one) => own.some((word) => word.startsWith(one)));
}

/**
 * The rows for what was typed. Nothing typed is every act, in the order they
 * were offered, which is the whole of the cheat sheet. Typed, the note an
 * address resolves to comes first, then the acts the words begin, then the
 * notes reached, then any act whose label merely contains the words.
 */
export function rowsFor(
	needle: string,
	acts: readonly PaletteAct[],
	notes: readonly FoundNote[],
	exact: OwnedRef | null
): PaletteRow[] {
	const asked = needle.trim();
	if (asked === '') return acts.map((act) => ({ kind: 'act', key: `act:${act.id}`, act }));
	const lowered = asked.toLowerCase();
	const first = exact === null ? [] : notes.filter((note) => note.ref === exact);
	const rest = notes.filter((note) => note.ref !== exact);
	const begun = acts.filter((act) => reaches(act.label, asked));
	const within = acts.filter(
		(act) => !begun.includes(act) && act.label.toLowerCase().includes(lowered)
	);
	return [
		...first.map((note) => ({ kind: 'note' as const, key: `note:${note.ref}`, note })),
		...begun.map((act) => ({ kind: 'act' as const, key: `act:${act.id}`, act })),
		...rest.map((note) => ({ kind: 'note' as const, key: `note:${note.ref}`, note })),
		...within.map((act) => ({ kind: 'act' as const, key: `act:${act.id}`, act }))
	];
}

/**
 * The heading to draw above the row at `at`, where that row opens a group of
 * acts; absent where it does not. Nothing is headed while words are typed:
 * the order then is how well each row matched, not what it belongs to.
 */
export function headingAt(rows: readonly PaletteRow[], at: number): string | undefined {
	const row = rows[at];
	if (row === undefined || row.kind !== 'act') return undefined;
	const before = at === 0 ? undefined : rows[at - 1];
	if (before !== undefined && (before.kind !== 'act' || before.act.group === row.act.group))
		return undefined;
	return row.act.group;
}
