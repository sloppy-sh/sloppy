/**
 * The colour maths `@sloppy/graph` does not carry, which is the two ends of it:
 * a colour read off a vendored palette, and one written back out as a token's
 * value. Everything in between is `@sloppy/graph`'s.
 */

import { apart, fromSrgb8, type Oklch, parseCssColor, toSrgb8 } from '@sloppy/graph';

/** One colour of a vendored palette. Throws on anything that is not a colour:
 *  the collection is six-digit hex, checked where it is vendored. */
export function colourOf(hex: string): Oklch {
	const read = parseCssColor(hex);
	if (read === null) throw new Error(`${hex} is not a colour`);
	return read;
}

/** `#rrggbb`. A dressing paints the bytes it was measured on, so what a floor
 *  cleared here is what the screen is handed. */
export function hexOf(color: Oklch): string {
	return `#${toSrgb8(color)
		.map((channel) => channel.toString(16).padStart(2, '0'))
		.join('')}`;
}

/** How far apart two colours look once painted — the OKLab distance DESIGN.md
 *  § Lightness states the slot separation in, measured on the bytes. */
export function distance(a: Oklch, b: Oklch): number {
	return apart(fromSrgb8(toSrgb8(a)), fromSrgb8(toSrgb8(b)));
}
