import { describe, expect, it } from 'vitest';
import {
	OPENING_STRENGTH,
	OPENING_TURN,
	sanitizeWallpaper,
	sanitizeWallpapers,
	WALLPAPER_TURNS,
	wallpaperTurn,
	type WallpaperPrefs
} from './wallpaper.js';

const MINUTE = 60_000;

function pictures(uploads: string[], every = 60): WallpaperPrefs {
	return { uploads, strength: 0.5, every };
}

describe('reading a stored wallpaper', () => {
	it('takes what somebody actually chose', () => {
		expect(sanitizeWallpaper({ uploads: ['a', 'b'], strength: 0.4, every: 30 })).toEqual({
			uploads: ['a', 'b'],
			strength: 0.4,
			every: 30
		});
	});

	it('opens a shape it cannot read on the plain theme rather than throwing', () => {
		for (const held of [null, 'a picture', 42, {}, { uploads: [] }, { uploads: [7, null] }]) {
			expect(sanitizeWallpaper(held)).toBeNull();
		}
	});

	it('fills in what a half-written shape left out', () => {
		expect(sanitizeWallpaper({ uploads: ['a'] })).toEqual({
			uploads: ['a'],
			strength: OPENING_STRENGTH,
			every: OPENING_TURN
		});
	});

	it('holds a strength somebody hand-edited inside what a slider offers', () => {
		expect(sanitizeWallpaper({ uploads: ['a'], strength: 9 })?.strength).toBe(1);
		expect(sanitizeWallpaper({ uploads: ['a'], strength: -3 })?.strength).toBe(0);
	});

	it('keeps the graphs it can read and drops the ones it cannot', () => {
		expect(
			sanitizeWallpapers({ own: { uploads: ['a'], strength: 0.2, every: 30 }, other: {} })
		).toEqual({ own: { uploads: ['a'], strength: 0.2, every: 30 } });
	});
});

// DESIGN.md § "The wallpaper": whose turn it is comes off the clock, so nothing
// counts down while somebody is reading and two devices agree with no sync.
describe('whose turn it is', () => {
	it('is the one picture, wherever the clock is', () => {
		const one = pictures(['a']);
		for (const at of [0, 5 * MINUTE, 4000 * MINUTE]) {
			expect(wallpaperTurn(one, at)).toBe('a');
		}
	});

	it('holds a picture for the whole of its turn and then hands over', () => {
		const two = pictures(['a', 'b'], 30);
		expect(wallpaperTurn(two, 0)).toBe('a');
		expect(wallpaperTurn(two, 29 * MINUTE)).toBe('a');
		expect(wallpaperTurn(two, 30 * MINUTE)).toBe('b');
		expect(wallpaperTurn(two, 60 * MINUTE)).toBe('a');
	});

	it('answers the same for one clock however it is asked', () => {
		const three = pictures(['a', 'b', 'c'], 30);
		const at = 1_763_000_000_000;
		expect(wallpaperTurn(three, at)).toBe(wallpaperTurn(three, at));
	});

	it('has nothing to show where nothing was picked', () => {
		expect(wallpaperTurn(pictures([]), 0)).toBeNull();
	});
});

describe('the turns on offer', () => {
	it('runs shortest to longest, so the list reads as one scale', () => {
		const values = WALLPAPER_TURNS.map((turn) => turn.value);
		expect(values).toEqual([...values].sort((a, b) => a - b));
	});
});
