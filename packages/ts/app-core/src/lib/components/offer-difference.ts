// A note against the writing somebody offers on it, in the language a
// difference between two states is already read in — DESIGN.md § "Whose
// writing" and § "A difference between two states".

import { splitOwnedRef, type BlockDocument, type OwnedRef, type Tag } from '@sloppy/types';
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

/** Whether the two sides say anything different at all. */
export function offerSaysSomething(now: WritingSide, offered: WritingSide): boolean {
	const apart = sectionsApart(now, offered);
	const tags = tagsApart(now, offered);
	return (
		apart.sections.length > 0 ||
		apart.reordered ||
		now.title !== offered.title ||
		tags.added.length > 0 ||
		tags.removed.length > 0
	);
}
