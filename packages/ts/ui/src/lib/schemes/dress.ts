/**
 * A scheme's palette as the tokens that dress the app. DESIGN.md § Schemes is
 * the doc of record for the mapping, the floors and why each of them is where
 * it is; `dress.test.ts` sweeps the whole collection against them.
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

/** What a field's own boundary owes the page it stands on — a line nobody can
 *  see is not a boundary. */
const EDGE_FLOOR = 1.5;

/** How far a surface stands from another to read as a surface of its own, in
 *  OKLab distance. */
const SURFACE_STEP = 0.04;

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
 * pair at least `gap` apart, the room taken from the gaps that have it to spare
 * and the ring turned so the slots move as little as that allows. `gap` times
 * their number must not exceed the circle.
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
 * These hues as the eight slots at ONE lightness: the one nearest `from` that
 * holds every slot above {@link MARK_FLOOR} on every surface and every pair
 * {@link DEPTH_SEPARATION} apart, with a pair the chroma in hand cannot tell
 * apart {@link opened} rather than discarded. Null where no lightness does.
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
 * `mark` at the nearest lightness that reads at {@link LABEL_FLOOR} on every one
 * of `surfaces`, its hue kept — and `mark` itself where it already does. Total:
 * where no lightness reads on all of them this is the closest the scheme comes,
 * which is what {@link dress} turns a scheme down on.
 *
 * Scanned rather than walked toward one end of the ramp, because two of a
 * collection's surfaces can straddle the mark.
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

/** `field` at the nearest lightness carrying {@link EDGE_FLOOR} on `page`, its
 *  hue kept, measured on the bytes it is painted as. Null where no lightness
 *  does. */
function bounds(field: Oklch, page: Oklch): Oklch | null {
	const seen = (one: Oklch): boolean => contrastRatio(colourOf(hexOf(one)), page) >= EDGE_FLOOR;
	if (seen(field)) return field;
	for (const l of lightnessesNear(field.l)) {
		const moved = intoGamut({ ...field, l });
		if (seen(moved)) return moved;
	}
	return null;
}

/**
 * The surface a highlighted row is drawn in: `quiet` stepped away from the page
 * until it is {@link SURFACE_STEP} off both the panel it lands on and the quiet
 * surface itself — a collection states one selection colour, and the muted
 * surface already has it. Null where the ramp leaves no room for one.
 */
function highlight(paper: Oklch, raised: Oklch, quiet: Oklch): Oklch | null {
	const away = quiet.l >= paper.l ? 1 : -1;
	for (let step = 1; step <= LIGHTNESS_STEPS; step += 1) {
		const l = quiet.l + (away * step) / LIGHTNESS_STEPS;
		if (l < 0 || l > 1) break;
		const found = intoGamut({ ...quiet, l });
		if (distance(found, quiet) >= SURFACE_STEP && distance(found, raised) >= SURFACE_STEP)
			return found;
	}
	return null;
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
 * The tokens this scheme dresses the app in, or null where it cannot carry what
 * a person reads — DESIGN.md § Schemes names what a scheme is turned down on.
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

	const surfaces = [paper, raised, quiet];
	const reading = (mark: Oklch): Oklch | null => {
		const found = reads(mark, surfaces);
		return surfaces.some((on) => contrastRatio(found, on) < LABEL_FLOOR) ? null : found;
	};
	const line = reading(at('base04'));
	const alarm = reading(at('base08'));
	if (line === null || alarm === null) return null;

	const spot = highlight(paper, raised, quiet);
	const field = bounds(at('base03'), paper);
	if (spot === null || field === null) return null;
	const onSpot = reads(ink, [spot]);
	if (contrastRatio(onSpot, spot) < LABEL_FLOOR) return null;

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
		'--accent': hexOf(spot),
		'--accent-foreground': hexOf(onSpot),
		'--muted': hexOf(quiet),
		'--muted-foreground': hexOf(line),
		'--input': hexOf(field),
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

const held = new Map<string, SchemeDressing | null>();

/** {@link dress}, answered once per slug for the life of the session: the picker
 *  dresses the scheme a person is wearing when it mounts and the whole
 *  collection when it opens, and the collection is five hundred schemes. */
export function dressed(scheme: Scheme): SchemeDressing | null {
	if (!held.has(scheme.slug)) held.set(scheme.slug, dress(scheme));
	return held.get(scheme.slug) ?? null;
}

/** Whether the picker offers this scheme, which is whether {@link dress} can
 *  dress the app in it at all. */
export function legible(scheme: Scheme): boolean {
	return dressed(scheme) !== null;
}
