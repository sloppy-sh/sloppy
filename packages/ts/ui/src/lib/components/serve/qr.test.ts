import { encode } from 'uqr';
import { describe, expect, it } from 'vitest';
import { qrDrawing } from './qr.js';

function darkCells(path: string): Set<string> {
	return new Set([...path.matchAll(/M(\d+) (\d+)/g)].map(([, x, y]) => `${x},${y}`));
}

describe('a QR code drawn for a ticket', () => {
	it('draws exactly the dark modules of the code, inside a quiet zone', () => {
		const text = 'endpointabc123'.repeat(12);
		const drawn = qrDrawing(text);
		const { data } = encode(text, { ecc: 'M', border: 4 });

		const expected = new Set<string>();
		data.forEach((row, y) => row.forEach((dark, x) => dark && expected.add(`${x},${y}`)));
		expect(darkCells(drawn.path)).toEqual(expected);
		expect(drawn.size).toBe(data.length);
		for (const cell of darkCells(drawn.path)) {
			const [x, y] = cell.split(',').map(Number);
			expect(Math.min(x, y, drawn.size - 1 - x, drawn.size - 1 - y)).toBeGreaterThanOrEqual(4);
		}
	});

	it('draws two tickets differently', () => {
		expect(qrDrawing('one desk').path).not.toBe(qrDrawing('another desk').path);
	});
});
