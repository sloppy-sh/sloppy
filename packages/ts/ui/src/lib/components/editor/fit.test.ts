// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMOJI_PX, fitted, NOTE_PX } from './fit.js';

/** A platform that decodes `wide` x `tall` and encodes what it drew as `size`
 *  bytes of `type` — or refuses to encode at all. */
function stub(wide: number, tall: number, drawn: { size: number; type?: string } | null): number[] {
	const box: number[] = [];
	vi.stubGlobal('createImageBitmap', async () => ({ width: wide, height: tall, close: () => {} }));
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
		drawImage: (_: unknown, ...at: number[]) => box.push(...at)
	} as unknown as CanvasRenderingContext2D);
	vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((done) =>
		done(drawn && new Blob([new Uint8Array(drawn.size)], { type: drawn.type ?? 'image/webp' }))
	);
	return box;
}

const picture = (name: string, type: string, size: number): File =>
	new File([new Uint8Array(size)], name, { type });

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('a picture on its way out of the device', () => {
	it('is redrawn at the size a note draws it, and named for what it became', async () => {
		const box = stub(4032, 3024, { size: 300_000 });
		const sent = await fitted(picture('IMG_0042.jpeg', 'image/jpeg', 4_200_000), NOTE_PX);

		expect(box).toEqual([0, 0, NOTE_PX, 1200]);
		expect(sent.size).toBe(300_000);
		expect(sent.type).toBe('image/webp');
		expect(sent.name).toBe('IMG_0042.webp');
	});

	it('is cut to the line a custom emoji is drawn on', async () => {
		const box = stub(512, 512, { size: 4_000 });
		await fitted(picture('grin.png', 'image/png', 900_000), EMOJI_PX);

		expect(box).toEqual([0, 0, EMOJI_PX, EMOJI_PX]);
	});

	it('goes as it is where redrawing it would lose the animation', async () => {
		stub(800, 800, { size: 10 });
		const moving = picture('wave.gif', 'image/gif', 3_000_000);

		expect(await fitted(moving, NOTE_PX)).toBe(moving);
	});

	it('goes as it is where it is already no wider than a note draws it', async () => {
		stub(900, 600, { size: 10 });
		const small = picture('sketch.png', 'image/png', 90_000);

		expect(await fitted(small, NOTE_PX)).toBe(small);
	});

	// A browser that will not encode WebP answers in PNG, which for a photograph
	// is larger than what it was handed.
	it('goes as it is where nothing was gained by redrawing it', async () => {
		stub(4032, 3024, { size: 9_000_000, type: 'image/png' });
		const photo = picture('IMG_0042.jpeg', 'image/jpeg', 4_200_000);

		expect(await fitted(photo, NOTE_PX)).toBe(photo);
	});

	it('goes as it is where the platform will not read it', async () => {
		vi.stubGlobal('createImageBitmap', async () => {
			throw new Error('no decoder');
		});
		const odd = picture('odd.png', 'image/png', 5_000_000);

		expect(await fitted(odd, NOTE_PX)).toBe(odd);
	});
});
