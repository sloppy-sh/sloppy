// What the facet surfaces are handed. The facet axis is AI.md's second axis:
// typed dimensions, one value per dimension, so sets intersect across the
// genealogical tree rather than alongside it.

import type { FacetSlot, LabelDimensionView, LabelSet } from '@sloppy/types';

/** A dimension's hue slot, `undefined` for one this reader does not have.
 *  `labels.slotFor` in `@sloppy/app-core` is the implementation. */
export type SlotLookup = (dimension: string) => FacetSlot | undefined;

export interface LabelPickerProps {
	/** In declaration order — the order the slots were handed out in. */
	dimensions: readonly LabelDimensionView[];
	/** What the note carries now. */
	labels: LabelSet;
	slotFor: SlotLookup;
	/**
	 * Store the note's whole label set. Rejecting puts the chips back on what
	 * the note still carries, and {@link refused} is what the person is told.
	 */
	onassign: (labels: LabelSet) => Promise<void>;
	/** The server's own words for a set that would not save, where it gave any. */
	refused?: string | null;
	/** Where a reader with nothing declared goes to declare a dimension. */
	manageHref?: string;
}

/** A value as the editor holds it. `was` absent where the reader has just added
 *  it, so a changed `now` is a rename and not one value swapped for another. */
export interface EditedValue {
	was?: string;
	now: string;
}

export interface DimensionDraft {
	name: string;
	values: EditedValue[];
	/** Absent leaves the hue to declaration order — DESIGN.md § Hue. */
	color_slot?: FacetSlot;
}

export interface ValueChanges {
	/** The list the dimension ends up holding, trimmed and deduplicated. */
	after: string[];
	renames: { from: string; to: string }[];
	/**
	 * Both names of every rename alongside the rest. Dropping a value notes
	 * still carry is refused, so a rename declares the new name first, moves
	 * the notes onto it, and only then drops the old one.
	 */
	bridge: string[];
}

export function valueChanges(
	before: readonly string[],
	draft: readonly EditedValue[]
): ValueChanges {
	const after: string[] = [];
	const renames: { from: string; to: string }[] = [];
	for (const value of draft) {
		const now = value.now.trim();
		if (!now || after.includes(now)) continue;
		after.push(now);
		if (value.was !== undefined && value.was !== now && before.includes(value.was)) {
			renames.push({ from: value.was, to: now });
		}
	}
	return { after, renames, bridge: [...new Set([...before, ...after])] };
}
