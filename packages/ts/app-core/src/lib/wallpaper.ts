/**
 * The picture under a graph: which ones, how much of them shows, and how often
 * they take turns. DESIGN.md § "The wallpaper" is the doc of record.
 *
 * A per-device view choice like the ground beside it, so nothing here is on a
 * note and nothing here reaches a peer.
 */

import type { OwnedRef } from '@sloppy/types';

export interface WallpaperPrefs {
	/** Library pictures in the order they take turns. One is a still ground. */
	uploads: string[];
	/** How much of the picture the reader asked for, 0–1 of what the ground can
	 *  carry — `paperCeiling` in `@sloppy/graph` is what that is. */
	strength: number;
	/** Minutes a picture holds before the next takes its turn. */
	every: number;
}

/** Where the control leaves a first pick: quiet enough to read as paper with a
 *  picture in it rather than as a picture with notes on it. */
export const OPENING_STRENGTH = 0.25;

/** The turn a first pick starts on. */
export const OPENING_TURN = 60;

export const WALLPAPER_TURNS: { value: number; label: string }[] = [
	{ value: 30, label: 'Every half hour' },
	{ value: 60, label: 'Hourly' },
	{ value: 360, label: 'Every six hours' },
	{ value: 1440, label: 'Daily' }
];

/**
 * Guard a stored shape — an older version, a hand-edited store: anything
 * malformed collapses to no wallpaper rather than throwing.
 */
export function sanitizeWallpaper(value: unknown): WallpaperPrefs | null {
	if (!value || typeof value !== 'object') return null;
	const held = value as Record<string, unknown>;
	const uploads = Array.isArray(held.uploads)
		? held.uploads.filter((one): one is string => typeof one === 'string' && one !== '')
		: [];
	if (uploads.length === 0) return null;
	return {
		uploads,
		strength: bounded(held.strength, OPENING_STRENGTH, 0, 1),
		every: bounded(held.every, OPENING_TURN, 1, 10080)
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

/**
 * Whose turn it is, as a function of the clock rather than of a timer — so two
 * devices land on the same picture at the same hour with nothing to sync, and
 * nothing counts down while somebody is reading.
 */
export function wallpaperTurn(prefs: WallpaperPrefs, at: number): string | null {
	const { uploads } = prefs;
	if (uploads.length === 0) return null;
	const turn = Math.floor(at / (prefs.every * 60_000));
	return uploads[((turn % uploads.length) + uploads.length) % uploads.length];
}

function bounded(value: unknown, fallback: number, low: number, high: number): number {
	return typeof value === 'number' && Number.isFinite(value)
		? Math.min(high, Math.max(low, value))
		: fallback;
}
