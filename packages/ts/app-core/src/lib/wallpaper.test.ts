import { PICTURE_TURN_DEFAULT, pictureTurn, QUIETEST_TRANSITION } from '@sloppy/types';
import { describe, expect, it } from 'vitest';
import {
	OPENING_STRENGTH,
	openingWallpaper,
	sanitizeWallpaper,
	sanitizeWallpapers
} from './wallpaper.js';

describe('reading a stored wallpaper', () => {
	it('takes what somebody actually chose', () => {
		expect(
			sanitizeWallpaper({
				pictures: ['a', 'b'],
				strength: 0.4,
				every: 30,
				transition: 'zoom'
			})
		).toEqual({ pictures: ['a', 'b'], strength: 0.4, every: 30, transition: 'zoom' });
	});

	it('opens a shape it cannot read on the plain theme rather than throwing', () => {
		for (const held of [null, 'a picture', 42, {}, { pictures: [] }, { pictures: [7, null] }]) {
			expect(sanitizeWallpaper(held)).toBeNull();
		}
	});

	it('fills in what a half-written shape left out', () => {
		expect(sanitizeWallpaper({ pictures: ['a'] })).toEqual({
			pictures: ['a'],
			strength: OPENING_STRENGTH,
			every: PICTURE_TURN_DEFAULT,
			transition: QUIETEST_TRANSITION
		});
	});

	// A ground chosen before the pictures were spelt this way is still a ground
	// somebody chose.
	it('keeps a picture stored under the name the ground used to give it', () => {
		expect(sanitizeWallpaper({ uploads: ['a', 'b'], strength: 0.4 })?.pictures).toEqual(['a', 'b']);
	});

	it('holds a strength somebody hand-edited inside what a slider offers', () => {
		expect(sanitizeWallpaper({ pictures: ['a'], strength: 9 })?.strength).toBe(1);
		expect(sanitizeWallpaper({ pictures: ['a'], strength: -3 })?.strength).toBe(0);
	});

	// The ground and a mark's imagery are one model, so a cadence and a
	// transition are held to what that model allows rather than to a second set
	// of bounds written out here.
	it('holds a cadence and a transition to what a series may take', () => {
		expect(sanitizeWallpaper({ pictures: ['a'], every: 9_999_999 })?.every).toBe(10_080);
		expect(sanitizeWallpaper({ pictures: ['a'], every: 0 })?.every).toBe(1);
		expect(sanitizeWallpaper({ pictures: ['a'], transition: 'dissolve' })?.transition).toBe(
			QUIETEST_TRANSITION
		);
	});

	it('keeps the graphs it can read and drops the ones it cannot', () => {
		const own = { pictures: ['a'], strength: 0.2, every: 30, transition: 'slide' };
		expect(sanitizeWallpapers({ own, other: {} })).toEqual({ own });
	});
});

describe('a first picture', () => {
	it('opens quiet enough to read a graph over, and still', () => {
		const first = openingWallpaper();
		expect(first).toEqual({
			pictures: [],
			strength: OPENING_STRENGTH,
			every: PICTURE_TURN_DEFAULT,
			transition: QUIETEST_TRANSITION
		});
		expect(pictureTurn(first, 0)).toBeUndefined();
	});

	// DESIGN.md § "The wallpaper": quiet enough to read as paper with a picture
	// in it rather than as a picture with notes on it.
	it('shows less than half of what the ground could carry', () => {
		expect(OPENING_STRENGTH).toBeGreaterThan(0);
		expect(OPENING_STRENGTH).toBeLessThan(0.5);
	});
});
