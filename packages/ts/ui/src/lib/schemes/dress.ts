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
 *  scheme with no eight hues of its own to lend is lent. `app.css` declares them
 *  per theme, and `dress.test.ts` holds these to what is there. */
const FACET_CHROMA = 0.13;
const SLOPPY_HUES = [25, 70, 115, 160, 205, 250, 295, 340];

/** At or under this chroma a colour is a neutral in this design system
 *  (DESIGN.md § "Theme presets"), and a neutral has no hue to lend. */
const NEUTRAL_CHROMA = 0.02;

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

/** The least two hues can be apart, in degrees, and still reach
 *  {@link DEPTH_SEPARATION} at chroma `room` — null where that chroma puts no two
 *  hues that far apart however the circle is divided. */
function leastGap(room: number): number | null {
	const half = DEPTH_SEPARATION / (2 * room);
	return half > 1 ? null : (2 * Math.asin(half) * 180) / Math.PI;
}

/**
 * These hues — in the order they run round the circle — with every neighbouring
 * pair at least `gap` apart. `gap` times their number must not exceed the
 * circle.
 *
 * The room comes out of the gaps that have it to spare, in proportion to what
 * they have, and the ring is then turned so the slots' displacements sum to
 * zero — which is the turn that moves them least.
 */
function opened(hues: readonly number[], gap: number): number[] {
	const gaps = hues.map((hue, at) => (hues[(at + 1) % hues.length] - hue + 360) % 360);
	const owed = gaps.reduce((sum, one) => sum + Math.max(0, gap - one), 0);
	if (owed === 0) return [...hues];
	const spare = gaps.reduce((sum, one) => sum + Math.max(0, one - gap), 0);
	const kept = 1 - owed / spare;
	const widened = gaps.map((one) => gap + Math.max(0, one - gap) * kept);
	const running = (steps: readonly number[]): number[] =>
		steps.map((_, at) => steps.slice(0, at).reduce((sum, one) => sum + one, 0));
	const was = running(gaps);
	const now = running(widened);
	const turn = was.reduce((sum, one, at) => sum + (one - now[at]), 0) / was.length;
	return now.map((one) => (((hues[0] + one + turn) % 360) + 360) % 360);
}

/**
 * These hues as the eight slots at ONE lightness — shared because the canvas
 * spends lightness on depth alone (DESIGN.md § "The graph's colour language"),
 * so the slots may not spend it on each other. Hue is what is left to tell them
 * apart, so a pair the scheme drew closer than the chroma in hand can carry is
 * {@link opened} rather than discarded.
 *
 * The lightness is the one nearest `from` that holds every slot above
 * {@link MARK_FLOOR} on every surface and every pair {@link DEPTH_SEPARATION}
 * apart. Null where no lightness does. How much chroma a lightness leaves in
 * hand is read off the hues as they arrive, which is what the opening is sized
 * by; what the opened ring actually paints is then measured.
 */
function heldApart(
	hues: readonly number[],
	from: number,
	surfaces: readonly Oklch[]
): Oklch[] | null {
	for (const l of lightnessesNear(from)) {
		const room = Math.min(...hues.map((hue) => intoGamut({ l, c: FACET_CHROMA, h: hue }).c));
		const gap = leastGap(room);
		if (gap === null || gap * hues.length > 360) continue;
		const slots = opened(hues, gap)
			.sort((a, b) => a - b)
			.map((hue) => intoGamut({ l, c: FACET_CHROMA, h: hue }));
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

/** The hues a scheme lends its slots: its own, in its own order round the
 *  circle, and Sloppy's where it has no eight hues to lend — an eight that is
 *  neutral, or one its own surfaces leave nowhere to stand. */
function facetsOf(scheme: Scheme, surfaces: readonly Oklch[]): Oklch[] | null {
	const own = FACET_KEYS.map((key) => colourOf(scheme.palette[key]));
	const from = own.reduce((sum, slot) => sum + slot.l, 0) / own.length;
	const hues = [...own].sort((a, b) => a.h - b.h).map((slot) => slot.h);
	const lends = own.some((slot) => slot.c > NEUTRAL_CHROMA);
	const lent = lends ? heldApart(hues, from, surfaces) : null;
	return lent ?? heldApart(SLOPPY_HUES, from, surfaces);
}

/**
 * The tokens this scheme dresses the app in, or null where it cannot: its own
 * ink does not read on its own page, no one secondary line or alarm reads on
 * every surface it lands on, or its surfaces leave the eight slots nowhere to
 * stand. Null is a scheme the picker does not offer.
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
	const reading = (mark: Oklch): Oklch | null => {
		const found = reads(mark, surfaces);
		return surfaces.some((on) => contrastRatio(found, on) < LABEL_FLOOR) ? null : found;
	};
	const line = reading(at('base04'));
	const alarm = reading(at('base08'));
	if (line === null || alarm === null) return null;

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
		// The alarm reads at AA on the page, and the page is one of the two ends,
		// so the end that reads best on it reads at AA too.
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
