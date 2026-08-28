// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShownPicture } from './contract.js';
import { tileSized } from './thumbnail.js';

let released: number;
let closed: number;
let revoked: string[];
let drawnAt: number[];

function whole(): ShownPicture {
	return { src: 'blob:whole', release: () => (released += 1) };
}

/** A platform that decodes `wide` x `tall` and can, or cannot, draw it again. */
function stub(wide: number, tall: number, canDraw = true): void {
	vi.stubGlobal('fetch', async () => ({ blob: async () => new Blob() }));
	vi.stubGlobal('createImageBitmap', async () => ({
		width: wide,
		height: tall,
		close: () => (closed += 1)
	}));
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
		canDraw
			? ({
					drawImage: (_: unknown, ...box: number[]) => drawnAt.push(...box)
				} as unknown as CanvasRenderingContext2D)
			: null
	);
	vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((done) => done(new Blob()));
	URL.createObjectURL = () => 'blob:tile';
	URL.revokeObjectURL = (url: string) => revoked.push(url);
}

beforeEach(() => {
	released = 0;
	closed = 0;
	revoked = [];
	drawnAt = [];
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('a picture on its way into a grid tile', () => {
	it('is cut to the tile and the whole one is let go', async () => {
		stub(1400, 700);
		const picture = await tileSized(whole());

		expect(picture.src).toBe('blob:tile');
		expect(drawnAt).toEqual([0, 0, 256, 128]);
		expect(released).toBe(1);
		expect(closed).toBe(1);

		picture.release();
		expect(revoked).toEqual(['blob:tile']);
	});

	it('is left alone where it is already no bigger than a tile', async () => {
		stub(200, 120);
		const original = whole();

		expect(await tileSized(original)).toBe(original);
		expect(released).toBe(0);
		expect(closed).toBe(1);
	});

	it('is left alone where the platform cannot draw a smaller one', async () => {
		stub(1400, 700, false);
		const original = whole();

		expect(await tileSized(original)).toBe(original);
		expect(released).toBe(0);
		expect(closed).toBe(1);
	});

	it('is left alone where it cannot be read back at all', async () => {
		vi.stubGlobal('fetch', async () => {
			throw new Error('gone');
		});
		const original = whole();

		expect(await tileSized(original)).toBe(original);
		expect(released).toBe(0);
	});
});
