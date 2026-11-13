import { encode } from 'uqr';

/** A QR code as one SVG path in a `size`-square of unit modules, quiet zone included. */
export interface QrDrawing {
	size: number;
	path: string;
}

/** The quiet zone a reader needs round the code, in modules. */
const QUIET = 4;

export function qrDrawing(text: string): QrDrawing {
	const { size, data } = encode(text, { ecc: 'M', border: QUIET });
	let path = '';
	data.forEach((row, y) =>
		row.forEach((dark, x) => {
			if (dark) path += `M${x} ${y}h1v1h-1z`;
		})
	);
	return { size, path };
}
