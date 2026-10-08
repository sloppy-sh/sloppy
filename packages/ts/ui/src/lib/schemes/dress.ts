/**
 * A scheme's palette as the tokens that dress the app. DESIGN.md § Schemes is
 * the mapping's doc of record; the floors are the ones `token-contrast.test.ts`
 * already holds Sloppy's own themes to.
 */

import {
	contrastRatio,
	DEPTH_SEPARATION,
	intoGamut,
	LABEL_FLOOR,
	MARK_FLOOR,
	type Oklch
} from '@sloppy/graph';
import { colourOf, distance, hexOf } from './oklch.js';
import type { BaseKey, Scheme, SchemeDressing } from './scheme.js';

/** The chroma and the hues Sloppy's own facets are drawn at, which is what a
 *  scheme whose own eight have collapsed is lent. `app.css` declares them per
 *  theme, and `dress.test.ts` holds these to what is there. */
const FACET_CHROMA = 0.13;
const SLOPPY_HUES = [25, 70, 115, 160, 205, 250, 295, 340];

/** The eight a scheme's slots are taken from. */
const FACET_KEYS: readonly BaseKey[] = [
	'base08',
	'base09',
	'base0A',
	'base0B',
	'base0C',
	'base0D',
	'base0E',
	'base0F'
];

/** How finely the slots' shared lightness is looked for. */
const LIGHTNESS_STEPS = 100;

/** The least two hues can be apart, in degrees, and still reach
 *  {@link DEPTH_SEPARATION} at {@link FACET_CHROMA}: closer than this no
 *  lightness holds the eight apart, so the search is not worth running. */
const LEAST_HUE_GAP = (2 * Math.asin(DEPTH_SEPARATION / (2 * FACET_CHROMA)) * 180) / Math.PI;

/** Every lightness a search here looks at, nearest `from` first. */
function lightnessesNear(from: number): number[] {
	return Array.from({ length: LIGHTNESS_STEPS + 1 }, (_, step) => step / LIGHTNESS_STEPS).sort(
		(a, b) => Math.abs(a - from) - Math.abs(b - from) || b - a
	);
}

function toldApart(slots: readonly Oklch[]): boolean {
	return slots.every((slot, at) =>
		slots.slice(at + 1).every((other) => distance(slot, other) >= DEPTH_SEPARATION)
	);
}

/**
 * These hues as the eight slots at ONE lightness — shared because the canvas
 * spends lightness on depth alone (DESIGN.md § "The graph's colour language"),
 * so the slots may not spend it on each other.
 *
 * The lightness is the one nearest `from` that holds every slot above
 * {@link MARK_FLOOR} on every surface and every pair {@link DEPTH_SEPARATION}
 * apart. Null where no lightness does.
 */
function heldApart(
	hues: readonly number[],
	from: number,
	surfaces: readonly Oklch[]
): Oklch[] | null {
	for (const l of lightnessesNear(from)) {
		const slots = hues.map((hue) => intoGamut({ l, c: FACET_CHROMA, h: hue }));
		const clears = slots.every((slot) =>
			surfaces.every((on) => contrastRatio(slot, on) >= MARK_FLOOR)
		);
		if (clears && toldApart(slots)) return slots;
	}
	return null;
}

/**
 * `mark` at the nearest lightness that reads on every one of `surfaces`, its
 * hue kept — and `mark` itself where it already reads on all of them.
 *
 * Scanned rather than walked toward one end of the ramp: a collection's ladder
 * of surfaces does not run the way Sloppy's own does, so two of them can
 * straddle the mark, and what reads on both is then a band between them rather
 * than everything past a threshold. Total, and where no lightness reads on all
 * of them this is the closest the scheme comes — which is what {@link dress}
 * turns a scheme down on.
 */
function reads(mark: Oklch, surfaces: readonly Oklch[]): Oklch {
	const worst = (one: Oklch): number =>
		Math.min(...surfaces.map((surface) => contrastRatio(one, surface)));
	let best = mark;
	if (worst(best) >= LABEL_FLOOR) return best;
	for (const l of lightnessesNear(mark.l)) {
		const moved = intoGamut({ ...mark, l });
		if (worst(moved) >= LABEL_FLOOR) return moved;
		if (worst(moved) > worst(best)) best = moved;
	}
	return best;
}

/** The hues a scheme lends its slots: its own where they can be told apart at
 *  one lightness, and Sloppy's where they cannot — a scheme's eight that have
 *  collapsed are still its own sixteen in the picker, and the canvas still
 *  answers eight questions. */
function facetsOf(scheme: Scheme, surfaces: readonly Oklch[]): Oklch[] | null {
	const own = FACET_KEYS.map((key) => colourOf(scheme.palette[key]));
	const from = own.reduce((sum, slot) => sum + slot.l, 0) / own.length;
	const hues = [...own].sort((a, b) => a.h - b.h).map((slot) => slot.h);
	const lent = spread(hues) ? heldApart(hues, from, surfaces) : null;
	return lent ?? heldApart(SLOPPY_HUES, from, surfaces);
}

/** Whether these hues, sorted, are far enough apart around the circle for any
 *  lightness to hold them {@link DEPTH_SEPARATION} apart. */
function spread(hues: readonly number[]): boolean {
	return hues.every((hue, at) => {
		const next = hues[(at + 1) % hues.length];
		return (next - hue + 360) % 360 >= LEAST_HUE_GAP;
	});
}

/**
 * The tokens this scheme dresses the app in, or null where it cannot: its own
 * ink does not read on its own page, no one secondary line reads on every
 * surface it lands on, or its surfaces leave the eight slots nowhere to stand.
 * Null is a scheme the picker does not offer.
 */
export function dress(scheme: Scheme): SchemeDressing | null {
	const at = (key: BaseKey): Oklch => colourOf(scheme.palette[key]);
	const paper = at('base00');
	const raised = at('base01');
	const quiet = at('base02');
	const ink = at('base05');
	if (contrastRatio(ink, paper) < LABEL_FLOOR) return null;

	const facets = facetsOf(scheme, [paper, raised]);
	if (facets === null) return null;

	// A collection's base01 is a card anywhere on its ramp rather than a shade
	// off its page, so the raised panel is as much a surface the secondary line
	// lands on as the page is.
	const surfaces = [paper, raised, quiet];
	const line = reads(at('base04'), surfaces);
	if (surfaces.some((on) => contrastRatio(line, on) < LABEL_FLOOR)) return null;

	const alarm = at('base08');
	const onRaised = hexOf(reads(ink, [raised]));
	const onQuiet = hexOf(reads(ink, [quiet]));
	const tokens: Record<`--${string}`, string> = {
		'--background': hexOf(paper),
		'--foreground': hexOf(ink),
		'--card': hexOf(raised),
		'--card-foreground': onRaised,
		'--popover': hexOf(raised),
		'--popover-foreground': onRaised,
		'--secondary': hexOf(quiet),
		'--secondary-foreground': onQuiet,
		'--accent': hexOf(quiet),
		'--accent-foreground': onQuiet,
		'--muted': hexOf(quiet),
		'--muted-foreground': hexOf(line),
		'--input': hexOf(at('base03')),
		'--destructive': hexOf(alarm),
		'--destructive-foreground': hexOf(
			contrastRatio(paper, alarm) >= contrastRatio(ink, alarm) ? paper : ink
		),
		'--graph-paper': hexOf(paper),
		'--graph-ink': hexOf(ink)
	};
	for (const [slot, colour] of facets.entries()) tokens[`--facet-${slot + 1}`] = hexOf(colour);
	return { slug: scheme.slug, variant: scheme.variant, tokens };
}

/** Whether the picker offers this scheme, which is whether {@link dress} can
 *  dress the app in it at all. */
export function legible(scheme: Scheme): boolean {
	return dress(scheme) !== null;
}
