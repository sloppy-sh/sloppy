// Cutting a picture down to what a grid tile draws. Nothing below this serves a
// sized read, so a picker still receives whole originals; this is what stops a
// screenful of them being HELD whole for as long as the picker is open.

import type { ShownPicture } from './contract.js';

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
	let whole: ImageBitmap | undefined;
	try {
		whole = await createImageBitmap(await (await fetch(src)).blob());
		const scale = Math.min(1, TILE_PX / Math.max(whole.width, whole.height));
		if (scale === 1) return null;

		const canvas = document.createElement('canvas');
		canvas.width = Math.max(1, Math.round(whole.width * scale));
		canvas.height = Math.max(1, Math.round(whole.height * scale));
		const onto = canvas.getContext('2d');
		if (!onto) return null;
		onto.drawImage(whole, 0, 0, canvas.width, canvas.height);

		const cut = await new Promise<Blob | null>((done) => canvas.toBlob(done));
		if (!cut) return null;
		const url = URL.createObjectURL(cut);
		return { src: url, release: () => URL.revokeObjectURL(url) };
	} catch {
		return null;
	} finally {
		whole?.close();
	}
}
