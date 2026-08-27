// Colour maths for the canvas. DESIGN.md § Lightness puts this conversion in
// this package rather than in CSS: pixi takes numbers, and a renderer that
// reads getComputedStyle per node per frame is the easiest way to make the
// canvas slow.

export interface Oklch {
  l: number;
  c: number;
  h: number;
}

const FUNCTIONAL = /^([a-z]+)\(([^)]*)\)$/i;
const HEX = /^#([0-9a-f]{3,8})$/i;

/**
 * A CSS colour as OKLCH, or `null` for a notation this does not read.
 *
 * `getComputedStyle` hands back whichever space the token was authored in, so
 * every notation `app.css` can produce has to arrive here: `oklch()` today, and
 * the sRGB forms a browser substitutes for a fallback.
 */
export function parseCssColor(value: string): Oklch | null {
  const text = value.trim();
  if (text === "") return null;

  const hex = HEX.exec(text);
  if (hex) return fromHex(hex[1]);

  const call = FUNCTIONAL.exec(text);
  if (!call) return null;

  const name = call[1].toLowerCase();
  const parts = call[2]
    .split(/[\s,/]+/)
    .map((part) => part.trim())
    .filter((part) => part !== "");

  if (name === "oklch") {
    const [l, c, h] = parts;
    if (l === undefined || c === undefined || h === undefined) return null;
    return finite({ l: number(l), c: number(c), h: number(h) });
  }
  if (name === "oklab") {
    const [l, a, b] = parts;
    if (l === undefined || a === undefined || b === undefined) return null;
    return finite(fromOklab({ l: number(l), a: number(a), b: number(b) }));
  }
  if (name === "rgb" || name === "rgba") {
    const [r, g, b] = parts;
    if (r === undefined || g === undefined || b === undefined) return null;
    return finite(fromSrgb([byte(r), byte(g), byte(b)]));
  }
  if (name === "color") {
    const [space, r, g, b] = parts;
    if (space?.toLowerCase() !== "srgb") return null;
    if (r === undefined || g === undefined || b === undefined) return null;
    return finite(fromSrgb([number(r), number(g), number(b)]));
  }
  return null;
}

/** `0xRRGGBB`, the form pixi takes. */
export function toRgb24(color: Oklch): number {
  const [r, g, b] = toSrgb8(color);
  return (r << 16) | (g << 8) | b;
}

/**
 * `t` of the way from `from` to `to`, mixed in OKLab so the path between two
 * hues does not swing through a third.
 */
export function mixOklab(from: Oklch, to: Oklch, t: number): Oklch {
  const a = toOklab(from);
  const b = toOklab(to);
  const k = clamp(t, 0, 1);
  return fromOklab({
    l: a.l + (b.l - a.l) * k,
    a: a.a + (b.a - a.a) * k,
    b: a.b + (b.b - a.b) * k,
  });
}

/** WCAG 2.2 contrast ratio, 1–21, measured on the bytes a display is handed. */
export function contrastRatio(a: Oklch, b: Oklch): number {
  const la = relativeLuminance(toSrgb8(a));
  const lb = relativeLuminance(toSrgb8(b));
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * `color` pulled back toward `anchor` until it clears `floor` against `ground`.
 *
 * A ramp's far end is the one that runs out of contrast, and a mark that has
 * faded into the paper is not a quieter mark — it is a missing one. Returns
 * `anchor` when even that cannot clear the floor, so this is total.
 */
export function raiseToFloor(
  color: Oklch,
  ground: Oklch,
  anchor: Oklch,
  floor: number,
): Oklch {
  if (contrastRatio(color, ground) >= floor) return color;
  if (contrastRatio(anchor, ground) < floor) return anchor;

  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(mixOklab(anchor, color, mid), ground) >= floor) lo = mid;
    else hi = mid;
  }
  return mixOklab(anchor, color, lo);
}

/** Whether sRGB can show this colour without clipping a channel. */
export function inGamut(color: Oklch): boolean {
  return toLinearSrgb(color).every((v) => v >= -1e-4 && v <= 1 + 1e-4);
}

/**
 * The nearest showable colour on the same hue and lightness, found by giving up
 * chroma. Clipping instead is what turns one dimension's ramp into two hues:
 * the channels saturate unevenly, and the colour swings as it clips.
 */
export function intoGamut(color: Oklch): Oklch {
  if (inGamut(color)) return color;
  let lo = 0;
  let hi = color.c;
  for (let step = 0; step < 16; step++) {
    const mid = (lo + hi) / 2;
    if (inGamut({ ...color, c: mid })) lo = mid;
    else hi = mid;
  }
  return { ...color, c: lo };
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

export function fromOklab({ l, a, b }: Oklab): Oklch {
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return { l, c: Math.hypot(a, b), h: h < 0 ? h + 360 : h };
}

/** 8-bit sRGB, gamut-clamped — the bytes a display is handed. */
export function toSrgb8(color: Oklch): [number, number, number] {
  return toLinearSrgb(color).map((v) =>
    Math.round(clamp(gamma(v), 0, 1) * 255),
  ) as [number, number, number];
}

function toLinearSrgb(color: Oklch): [number, number, number] {
  const { l: L, a, b } = toOklab(color);
  const lr = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mr = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sr = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * lr - 3.3077115913 * mr + 0.2309699292 * sr,
    -1.2684380046 * lr + 2.6097574011 * mr - 0.3413193965 * sr,
    -0.0041960863 * lr - 0.7034186147 * mr + 1.707614701 * sr,
  ];
}

function fromSrgb([r, g, b]: [number, number, number]): Oklch {
  const R = linearFromUnit(r);
  const G = linearFromUnit(g);
  const B = linearFromUnit(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return fromOklab({
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  });
}

function fromHex(digits: string): Oklch | null {
  const wide = digits.length > 4;
  const size = wide ? 2 : 1;
  const channels = wide ? Math.floor(digits.length / 2) : digits.length;
  if (channels < 3) return null;
  const read = (index: number): number => {
    const part = digits.slice(index * size, index * size + size);
    const raw = Number.parseInt(wide ? part : part + part, 16);
    return raw / 255;
  };
  return finite(fromSrgb([read(0), read(1), read(2)]));
}

const gamma = (x: number): number =>
  x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;

const linearFromUnit = (v: number): number =>
  v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const R = linearFromUnit(r / 255);
  const G = linearFromUnit(g / 255);
  const B = linearFromUnit(b / 255);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** A channel written either as a fraction or as a percentage of one. */
function number(token: string): number {
  return token.endsWith("%") ? Number(token.slice(0, -1)) / 100 : Number(token);
}

/** A channel written either as a percentage or as one of 255. */
function byte(token: string): number {
  return token.endsWith("%")
    ? Number(token.slice(0, -1)) / 100
    : Number(token) / 255;
}

function finite(color: Oklch): Oklch | null {
  return Number.isFinite(color.l) &&
    Number.isFinite(color.c) &&
    Number.isFinite(color.h)
    ? color
    : null;
}

export function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}
