// A note against the writing somebody offers on it, in the language a
// difference between two states is already read in — DESIGN.md § "Whose
// writing" and § "A difference between two states".

import {
	COMPASS_DIRECTIONS,
	COMPASS_TYPE,
	compassOf,
	splitOwnedRef,
	type BlockDocument,
	type Compass,
	type CompassDirection,
	type DocumentNode,
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
	sections: readonly { ref: OwnedRef; content: BlockDocument }[];
}

function same(a: BlockDocument, b: BlockDocument): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/** What a slot gained and what it no longer holds. */
export interface CompassApart {
	direction: CompassDirection;
	gained: OwnedRef[];
	lost: OwnedRef[];
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
 * The slots the offer would change, in the order a compass is read in. A change
 * to where a note points is shown as the slot it moved rather than as a section
 * of changed markup — DESIGN.md § "The compass card".
 */
export function compassApart(now: WritingSide, offered: WritingSide): CompassApart[] {
	const before = compassIn(now);
	const after = compassIn(offered);
	if (!before && !after) return [];
	const apart: CompassApart[] = [];
	for (const direction of COMPASS_DIRECTIONS) {
		const was = before?.[direction] ?? [];
		const is = after?.[direction] ?? [];
		const gained = is.filter((note) => !was.includes(note));
		const lost = was.filter((note) => !is.includes(note));
		if (gained.length > 0 || lost.length > 0) apart.push({ direction, gained, lost });
	}
	return apart;
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

/** Whether the difference language has anything to draw. A compass stands
 *  outside it, and is read slot by slot instead. */
export function saysAnything(apart: ChangedNote): boolean {
	return apart.sections.length > 0 || apart.reordered || apart.retitled !== undefined;
}

/** Whether the offer says nothing at all — the whole of what a sheet draws,
 *  which is the difference language, the slots and the words together. */
export function saysNothing(
	apart: ChangedNote,
	compass: readonly CompassApart[],
	tags: { added: readonly Tag[]; removed: readonly Tag[] }
): boolean {
	return (
		!saysAnything(apart) &&
		compass.length === 0 &&
		tags.added.length === 0 &&
		tags.removed.length === 0
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
