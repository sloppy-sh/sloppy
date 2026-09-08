// How many device pixels of canvas one CSS pixel is drawn with. DESIGN.md
// § "The mark" is the doc of record.

/**
 * The most device pixels per CSS pixel anything on the canvas is drawn for. A
 * phone reaches 3 and so does a 4K desktop at 300%; past that the sharpening is
 * smaller than the memory it costs.
 */
export const MAX_DENSITY = 3;

/** What a screen reporting `dpr` device pixels per CSS pixel is drawn at. */
export function screenDensity(dpr = globalThis.devicePixelRatio): number {
  return Number.isFinite(dpr) && dpr > 1 ? Math.min(dpr, MAX_DENSITY) : 1;
}
