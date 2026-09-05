/**
 * The picture under a graph: which ones, how much of them shows, how often they
 * take turns and how one gives way to the next. DESIGN.md § "The wallpaper" is
 * the doc of record, and § "A picture that takes turns" is the model it shares
 * with a mark's imagery.
 *
 * A per-device view choice like the ground beside it, so nothing here is on a
 * note and nothing here reaches a peer.
 */

import {
	boundedTurn,
	knownTransition,
	type OwnedRef,
	PICTURE_TURN_DEFAULT,
	type PictureSeries,
	QUIETEST_TRANSITION
} from '@sloppy/types';

/** The series, plus the one thing that is the ground's alone: how much of it the
 *  reader must still be able to read the graph over. */
export interface WallpaperPrefs extends PictureSeries {
	/** 0–1 of what the ground can carry — `paperCeiling` in `@sloppy/graph` is
	 *  what that is. */
	strength: number;
}

/** Where the control leaves a first pick: quiet enough to read as paper with a
 *  picture in it rather than as a picture with notes on it. */
export const OPENING_STRENGTH = 0.25;

/**
 * Guard a stored shape — an older version, a hand-edited store: anything
 * malformed collapses to no wallpaper rather than throwing.
 */
export function sanitizeWallpaper(value: unknown): WallpaperPrefs | null {
	if (!value || typeof value !== 'object') return null;
	const held = value as Record<string, unknown>;
	// A ground is also stored under `uploads`, and a reader's picture is not worth
	// taking off their graph to retire a name.
	const from = held.pictures ?? held.uploads;
	const pictures = Array.isArray(from)
		? from.filter((one): one is string => typeof one === 'string' && one !== '')
		: [];
	if (pictures.length === 0) return null;
	return {
		pictures,
		strength: bounded(held.strength, OPENING_STRENGTH, 0, 1),
		every: boundedTurn(held.every),
		transition: knownTransition(held.transition)
	};
}

/** Every graph's wallpaper, dropping the ones that no longer parse. */
export function sanitizeWallpapers(value: unknown): Record<OwnedRef, WallpaperPrefs> {
	if (!value || typeof value !== 'object') return {};
	const out: Record<OwnedRef, WallpaperPrefs> = {};
	for (const [graph, held] of Object.entries(value as Record<string, unknown>)) {
		const kept = sanitizeWallpaper(held);
		if (kept) out[graph] = kept;
	}
	return out;
}

/** What a first pick starts on, before anybody has said otherwise. */
export function openingWallpaper(): WallpaperPrefs {
	return {
		pictures: [],
		strength: OPENING_STRENGTH,
		every: PICTURE_TURN_DEFAULT,
		transition: QUIETEST_TRANSITION
	};
}

function bounded(value: unknown, fallback: number, low: number, high: number): number {
	return typeof value === 'number' && Number.isFinite(value)
		? Math.min(high, Math.max(low, value))
		: fallback;
}
