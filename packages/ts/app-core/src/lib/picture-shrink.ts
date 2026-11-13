// A note's picture made small enough to send to a headset, drawn in the page that
// serves it — `PictureShrink` in `@sloppy/local`.

import type { PictureShrink } from '@sloppy/local';

export const shrinkPicture: PictureShrink = async (bytes, mime_type, longest) => {
	const drawn = await createImageBitmap(
		new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime_type })
	);
	try {
		const scale = Math.min(1, longest / Math.max(drawn.width, drawn.height));
		const width = Math.max(1, Math.round(drawn.width * scale));
		const height = Math.max(1, Math.round(drawn.height * scale));
		const canvas = new OffscreenCanvas(width, height);
		const pen = canvas.getContext('2d');
		if (!pen) throw new Error('This page cannot draw a picture.');
		pen.drawImage(drawn, 0, 0, width, height);
		const png = await canvas.convertToBlob({ type: 'image/png' });
		return { png: new Uint8Array(await png.arrayBuffer()), width, height };
	} finally {
		drawn.close();
	}
};
