// A note against the writing somebody offers on it, in the language a
// difference between two states is already read in — DESIGN.md § "Whose
// writing" and § "A difference between two states".

import {
	COMPASS_DIRECTIONS,
	COMPASS_TYPE,
	compassOf,
	DEFAULT_COMPASS_KIND,
	splitOwnedRef,
	type BlockDocument,
	type Compass,
	type CompassDirection,
	type CompassKind,
	type DocumentNode,
	type EdgeLook,
	type OwnedRef,
	type Tag
} from '@sloppy/types';
import type { ChangedNote, ChangedSection } from '@sloppy/ui';

/** One side of the comparison: a note's own writing, or an offer's. Sections
 *  stand in the order they read, and are matched across the two sides by the
 *  ref of the section they stand for. */
export interface WritingSide {
	title: string;
	tags: readonly Tag[];
	/** The looks on the note's lines, whole. Absent is a side that says nothing
	 *  about them, which is an offer that leaves the note's looks alone. */
	edges?: readonly EdgeLook[];
	sections: readonly { ref: OwnedRef; content: BlockDocument }[];
}

function same(a: BlockDocument, b: BlockDocument): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/** What a slot gained and what it no longer holds. */
export interface SlotApart {
	direction: CompassDirection;
	gained: OwnedRef[];
	lost: OwnedRef[];
}

/** Where an offer would have the note point, and which questions it would have
 *  the slots read as — the same method on both sides where it leaves that
 *  alone. */
export interface CompassApart {
	was: CompassKind;
	reads: CompassKind;
	slots: SlotApart[];
}

/** The note's compass, wherever in its writing it stands. */
function compassIn(side: WritingSide): Compass | undefined {
	for (const one of side.sections) {
		const held = compassOf(one.content);
		if (held) return held;
	}
	return undefined;
}

/** The same section with every compass emptied of its slots but left where it
 *  stands, so two sections that differ only in where the note points read as the
 *  same writing, and one where a compass arrived, went or moved does not. */
function withoutSlots(content: BlockDocument): BlockDocument {
	const strip = (nodes: readonly DocumentNode[]): DocumentNode[] =>
		nodes.map((one) => {
			if (one.type === COMPASS_TYPE) return { type: COMPASS_TYPE };
			return one.content ? { ...one, content: strip(one.content) } : one;
		});
	return { ...content, content: strip(content.content ?? []) };
}

/**
 * The slots the offer would change, in the order a compass is read in, and the
 * method it would read them in. A change to where a note points is shown as the
 * slot it moved rather than as a section of changed markup — DESIGN.md § "The
 * compass card".
 */
export function compassApart(now: WritingSide, offered: WritingSide): CompassApart {
	const before = compassIn(now);
	const after = compassIn(offered);
	const slots: SlotApart[] = [];
	for (const direction of COMPASS_DIRECTIONS) {
		const was = before?.[direction] ?? [];
		const is = after?.[direction] ?? [];
		const gained = is.filter((note) => !was.includes(note));
		const lost = was.filter((note) => !is.includes(note));
		if (gained.length > 0 || lost.length > 0) slots.push({ direction, gained, lost });
	}
	return {
		was: before?.kind ?? DEFAULT_COMPASS_KIND,
		reads: after?.kind ?? DEFAULT_COMPASS_KIND,
		slots
	};
}

/** The sections the two sides do not share, and whether the ones they do share
 *  stand in another order. */
export function sectionsApart(
	now: WritingSide,
	offered: WritingSide
): { sections: ChangedSection[]; reordered: boolean } {
	const before = new Map(now.sections.map((one) => [one.ref, one.content]));
	const after = new Map(offered.sections.map((one) => [one.ref, one.content]));
	const sections: ChangedSection[] = [];
	for (const one of offered.sections) {
		const was = before.get(one.ref);
		if (was !== undefined && same(was, one.content)) continue;
		if (was !== undefined && same(withoutSlots(was), withoutSlots(one.content))) continue;
		sections.push({
			ulid: splitOwnedRef(one.ref).localId,
			...(was === undefined ? {} : { before: was }),
			after: one.content
		});
	}
	for (const one of now.sections) {
		if (after.has(one.ref)) continue;
		sections.push({ ulid: splitOwnedRef(one.ref).localId, before: one.content });
	}
	const kept = (side: WritingSide, other: ReadonlyMap<OwnedRef, BlockDocument>) =>
		side.sections.map((one) => one.ref).filter((ref) => other.has(ref));
	const here = kept(now, after);
	const there = kept(offered, before);
	return {
		sections,
		reordered: here.length === there.length && here.some((ref, at) => ref !== there[at])
	};
}

/** The words the offer would have the note carry that it does not, and the ones
 *  it would take off. Tags stand outside the difference language, which reads a
 *  note section by section. */
export function tagsApart(
	now: WritingSide,
	offered: WritingSide
): { added: Tag[]; removed: Tag[] } {
	const before = new Set(now.tags);
	const after = new Set(offered.tags);
	return {
		added: offered.tags.filter((tag) => !before.has(tag)),
		removed: now.tags.filter((tag) => !after.has(tag))
	};
}

/** One line the offer would draw differently, and the look it would have on it —
 *  absent where the offer takes the look off. */
export interface LookApart {
	to: OwnedRef;
	look?: EdgeLook;
}

/**
 * The lines the offer would draw differently, in the order the offer names them,
 * with the ones it drops after. An offer that names no look at all leaves every
 * line alone and has nothing to show — DESIGN.md § Edges, "A look a person set".
 */
export function looksApart(now: WritingSide, offered: WritingSide): LookApart[] {
	if (offered.edges === undefined) return [];
	const before = new Map((now.edges ?? []).map((look) => [look.to, look]));
	const after = new Set(offered.edges.map((look) => look.to));
	const apart: LookApart[] = offered.edges
		.filter((look) => {
			const was = before.get(look.to);
			return was === undefined || !sameLook(was, look);
		})
		.map((look) => ({ to: look.to, look }));
	for (const look of now.edges ?? []) {
		if (!after.has(look.to)) apart.push({ to: look.to });
	}
	return apart;
}

function sameLook(a: EdgeLook, b: EdgeLook): boolean {
	return a.label === b.label && a.direction === b.direction && a.stroke === b.stroke;
}

/** Which end an arrowhead sits at, read against the note the look is on. */
const ARROWS: Record<NonNullable<EdgeLook['direction']>, string> = {
	to: '→',
	from: '←',
	both: '↔'
};

/** What a look says, as a row beside the note at the other end reads it. */
export function lookInWords(look: EdgeLook | undefined): string {
	if (look === undefined) return 'no look';
	const said = [
		...(look.label ? [`“${look.label}”`] : []),
		...(look.direction ? [ARROWS[look.direction]] : []),
		...(look.stroke ? [look.stroke] : [])
	];
	return said.length === 0 ? 'no look' : said.join(', ');
}

/** Whether the difference language has anything to draw. A compass stands
 *  outside it, and is read slot by slot instead. */
export function saysAnything(apart: ChangedNote): boolean {
	return apart.sections.length > 0 || apart.reordered || apart.retitled !== undefined;
}

/** Whether the offer says nothing at all — the whole of what a sheet draws,
 *  which is the difference language, the slots, the words and the lines
 *  together. */
export function saysNothing(
	apart: ChangedNote,
	compass: CompassApart,
	tags: { added: readonly Tag[]; removed: readonly Tag[] },
	looks: readonly LookApart[]
): boolean {
	return (
		!saysAnything(apart) &&
		compass.slots.length === 0 &&
		compass.was === compass.reads &&
		tags.added.length === 0 &&
		tags.removed.length === 0 &&
		looks.length === 0
	);
}

/**
 * What the offered writing says that the note does not, as the difference
 * language draws a note. `became` is always `kept`: an offer changes what a
 * note says and never whether it is there.
 */
export function offerDifference(
	note: { ref: OwnedRef; address?: string },
	now: WritingSide,
	offered: WritingSide
): ChangedNote {
	const apart = sectionsApart(now, offered);
	return {
		ref: note.ref,
		title: offered.title,
		...(note.address === undefined ? {} : { address: note.address }),
		became: 'kept',
		...(now.title === offered.title ? {} : { retitled: { from: now.title } }),
		reordered: apart.reordered,
		sections: apart.sections
	};
}
