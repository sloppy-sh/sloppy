/**
 * Colour maths for the token floors DESIGN.md § "Contrast is measured, not
 * assumed" sets. Every measurement here happens on the QUANTISED colour — both
 * sides converted to sRGB and rounded to 8 bits per channel — because that is
 * what a screen paints, and a ratio computed on the unrounded value can clear a
 * floor the display then misses.
 */

export interface Oklch {
	l: number;
	c: number;
	h: number;
}

const OKLCH = /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)\s*\)$/i;

/** `null` for anything that is not a bare `oklch(L C H)` literal. */
export function parseOklch(value: string): Oklch | null {
	const m = OKLCH.exec(value.trim());
	if (!m) return null;
	const raw = m[1];
	return {
		l: raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw),
		c: Number(m[2]),
		h: Number(m[3])
	};
}

export interface Oklab {
	l: number;
	a: number;
	b: number;
}

export function toOklab({ l, c, h }: Oklch): Oklab {
	const rad = (h * Math.PI) / 180;
	return { l, a: c * Math.cos(rad), b: c * Math.sin(rad) };
}

/** Euclidean in OKLab, the space DESIGN.md states the slot separation floor in. */
export function oklabDistance(a: Oklch, b: Oklch): number {
	const p = fromSrgb8(toSrgb8(a));
	const q = fromSrgb8(toSrgb8(b));
	return Math.hypot(p.l - q.l, p.a - q.a, p.b - q.b);
}

const gamma = (x: number): number =>
	x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;

const linearFromByte = (v: number): number => {
	const c = v / 255;
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** 8-bit sRGB, clamped — the bytes a display is handed. */
export function toSrgb8(color: Oklch): [number, number, number] {
	const { l: L, a, b } = toOklab(color);
	const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
	const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
	const s_ = L - 0.0894841775 * a - 1.291485548 * b;
	const l3 = l_ ** 3;
	const m3 = m_ ** 3;
	const s3 = s_ ** 3;
	const linear = [
		4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
		-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
		-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3
	];
	return linear.map((v) => Math.round(Math.min(1, Math.max(0, gamma(v))) * 255)) as [
		number,
		number,
		number
	];
}

/** The inverse of {@link toSrgb8}: what the bytes a display was handed mean
 *  back in OKLab, gamut clipping and rounding included. */
function fromSrgb8([r, g, b]: [number, number, number]): Oklab {
	const R = linearFromByte(r);
	const G = linearFromByte(g);
	const B = linearFromByte(b);
	const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
	const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
	const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
	return {
		l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
	};
}

function relativeLuminance(rgb: [number, number, number]): number {
	const [r, g, b] = rgb.map(linearFromByte);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.2 contrast ratio, 1–21. */
export function contrastRatio(a: Oklch, b: Oklch): number {
	const la = relativeLuminance(toSrgb8(a));
	const lb = relativeLuminance(toSrgb8(b));
	const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
	return (hi + 0.05) / (lo + 0.05);
}
