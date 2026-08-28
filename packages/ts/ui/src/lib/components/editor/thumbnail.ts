// Cutting a picture down to what a grid tile draws, so a screenful of them is
// not held whole for as long as the picker is open.

import type { ShownPicture } from './contract.js';
import { capped } from './fit.js';

/** The longest side a tile is ever drawn at, doubled for a dense screen. */
const TILE_PX = 256;

/** A tile-sized copy, with the whole picture released. Where no smaller one can
 *  be made, the picture itself comes back, unreleased. */
export async function tileSized(picture: ShownPicture): Promise<ShownPicture> {
	const tile = await cutDown(picture.src);
	if (!tile) return picture;
	picture.release();
	return tile;
}

async function cutDown(src: string): Promise<ShownPicture | null> {
	try {
		const tile = await capped(await (await fetch(src)).blob(), TILE_PX);
		if (!tile) return null;
		const url = URL.createObjectURL(tile);
		return { src: url, release: () => URL.revokeObjectURL(url) };
	} catch {
		return null;
	}
}
