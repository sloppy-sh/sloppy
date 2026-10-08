/**
 * The vendored Tinted Theming collection — DESIGN.md § Schemes. It is a third
 * of a megabyte and only the picker reads it, so it arrives on demand and
 * nothing imports it directly.
 */

import type { Scheme } from './scheme.js';

let loaded: Promise<readonly Scheme[]> | undefined;

/** Every scheme in the collection, by name. Loaded once per session; a read
 *  that failed is not held, so the next ask reads again. */
export function schemes(): Promise<readonly Scheme[]> {
	loaded ??= import('./schemes.json').then(
		(held) => held.default as unknown as readonly Scheme[],
		(why: unknown) => {
			loaded = undefined;
			throw why;
		}
	);
	return loaded;
}

/** One scheme, or null where the collection has nothing at that slug — a saved
 *  look from a build whose collection was a different one. */
export async function schemeBySlug(slug: string): Promise<Scheme | null> {
	return (await schemes()).find((scheme) => scheme.slug === slug) ?? null;
}
