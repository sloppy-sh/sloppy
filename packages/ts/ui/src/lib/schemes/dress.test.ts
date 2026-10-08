/**
 * The file of record for the mapping DESIGN.md § Schemes states, swept over the
 * whole vendored collection rather than over schemes chosen by hand: a dressing
 * is paint nobody at Sloppy picked, so either every scheme in the collection
 * holds the floors a theme is held to, or it is left out of the picker.
 */

import { contrastRatio, type Oklch, parseCssColor } from '@sloppy/graph';
import { TAG_HUE_SLOTS } from '@sloppy/types';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dress, dressed as dressOnce, legible } from './dress.js';
import { schemeBySlug, schemes } from './index.js';
import { distance } from './oklch.js';
import {
	BASE_KEYS,
	DRESSED_TOKENS,
	type Scheme,
	type SchemeDressing,
	UNDRESSED_TOKENS
} from './scheme.js';

const CSS = readFileSync(new URL('../app.css', import.meta.url), 'utf8');

/** What a mark carrying meaning on its own owes, and what text owes — the two
 *  floors DESIGN.md § "Contrast is measured" sets. */
const MARK_FLOOR = 3;
const TEXT_FLOOR = 4.5;

/** The least two slots may look alike — DESIGN.md § Lightness. */
const SLOT_SEPARATION = 0.03;

/** What a field's own boundary owes the page, and how far one surface stands
 *  from another to read as its own — DESIGN.md § Schemes. */
const EDGE_FLOOR = 1.5;
const SURFACE_STEP = 0.04;

/** The slots a selected tag can borrow, which is what a dressing owes eight
 *  colours for. */
const SLOTS = [...TAG_HUE_SLOTS];

/** The bound every token is held to in `prefs.svelte.ts` and in both shells'
 *  boot scripts, which DROP a token failing it rather than painting it — so a
 *  dressing built outside the bound is one that silently loses a token. */
const TOKEN_NAME = /^--[a-z0-9-]{1,40}$/;
const TOKEN_VALUE = /^[^;{}]{1,96}$/;

function colour(value: string): Oklch {
	const read = parseCssColor(value);
	if (read === null) throw new Error(`${value} is not a colour`);
	return read;
}

/** What `app.css` declares the facets as, slot by slot, over every theme block
 *  that declares them. */
function declaredFacets(): Map<number, Oklch[]> {
	const found = new Map<number, Oklch[]>();
	for (const [, slot, l, c, h] of CSS.matchAll(
		/--facet-(\d):\s*oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/g
	)) {
		const at = Number(slot);
		found.set(at, [...(found.get(at) ?? []), { l: Number(l), c: Number(c), h: Number(h) }]);
	}
	return found;
}

const DECLARED = declaredFacets();

function declaredAt(slot: number): Oklch {
	const declared = DECLARED.get(slot);
	if (declared === undefined) throw new Error(`app.css declares no --facet-${slot}`);
	return declared[0];
}

function painted(dressing: SchemeDressing, token: string): Oklch {
	const value = dressing.tokens[token as `--${string}`];
	if (value === undefined) throw new Error(`${dressing.slug} paints no ${token}`);
	return colour(value);
}

/** The tokens the mapping works out rather than taking from the scheme: the
 *  eight slots, and a mark lifted to read on its own surface. */
const DERIVED = new Set<string>([
	'--card-foreground',
	'--popover-foreground',
	'--secondary-foreground',
	'--accent',
	'--accent-foreground',
	'--muted-foreground',
	'--input',
	'--destructive',
	...SLOTS.map((slot) => `--facet-${slot}`)
]);

/** At or under this chroma a colour is a neutral in this design system
 *  (DESIGN.md § "Theme presets"), and a neutral has no hue to lend. */
const NEUTRAL_CHROMA = 0.02;

/** The eight a scheme's slots are taken from. */
const FACET_KEYS = BASE_KEYS.slice(8);

/** Each ink and a surface it lands on. The secondary line and the alarm land on
 *  three of them, because an unselected pill draws them on a card and the page
 *  draws them on itself. */
const INKS = [
	['--foreground', '--background'],
	['--card-foreground', '--card'],
	['--popover-foreground', '--popover'],
	['--secondary-foreground', '--secondary'],
	['--accent-foreground', '--accent'],
	['--muted-foreground', '--muted'],
	['--muted-foreground', '--background'],
	['--muted-foreground', '--card'],
	['--muted-foreground', '--popover'],
	['--destructive', '--background'],
	['--destructive', '--card'],
	['--destructive', '--muted'],
	['--destructive-foreground', '--destructive']
] as const;

/** The inks that are the scheme's own ink lifted onto a surface, which is every
 *  ink but the secondary line and the alarm — each drawn from its own colour. */
const FROM_INK = new Set<string>([
	'--foreground',
	'--card-foreground',
	'--popover-foreground',
	'--secondary-foreground',
	'--accent-foreground'
]);

/** The eight a scheme drew, in the order the slots take them. */
function ownHues(scheme: Scheme): Oklch[] {
	return FACET_KEYS.map((key) => colour(scheme.palette[key])).sort((a, b) => a.h - b.h);
}

function paintedHues(dressing: SchemeDressing): number[] {
	return SLOTS.map((slot) => painted(dressing, `--facet-${slot}`).h);
}

/** Whether these eight hues are the ones `app.css` declares. */
function sloppys(hues: readonly number[]): boolean {
	return hues.every((hue, at) => Math.abs(hue - declaredAt(SLOTS[at]).h) < 1.5);
}

/** Whether the canvas is wearing Sloppy's eight rather than the scheme's. A
 *  scheme whose own eight happen to BE that wheel is wearing its own. */
function borrows(scheme: Scheme, dressing: SchemeDressing): boolean {
	return sloppys(paintedHues(dressing)) && !sloppys(ownHues(scheme).map((one) => one.h));
}

/** How far the opening stood a slot from the hue the scheme drew it at, in
 *  degrees. The eight keep the scheme's own order round the circle, so the
 *  pairing is the one rotation of them that fits best. */
function openedBy(scheme: Scheme, dressing: SchemeDressing): number {
	const own = ownHues(scheme).map((one) => one.h);
	const hues = paintedHues(dressing);
	const away = (one: number, other: number): number => {
		const gap = Math.abs(one - other) % 360;
		return Math.min(gap, 360 - gap);
	};
	return Math.min(
		...own.map((_, turn) =>
			Math.max(...hues.map((hue, at) => away(hue, own[(at + turn) % own.length])))
		)
	);
}

const collection = await schemes();

const dressed: { scheme: Scheme; dressing: SchemeDressing }[] = [];
/** The schemes the picker leaves out. */
const skipped: Scheme[] = [];

for (const scheme of collection) {
	const dressing = dress(scheme);
	if (dressing === null) skipped.push(scheme);
	else dressed.push({ scheme, dressing });
}

describe('the collection', () => {
	it('is the Tinted Theming collection, both systems of it', () => {
		expect(collection).toHaveLength(571);
		expect(collection.filter((one) => one.system === 'base24').length).toBeGreaterThan(0);
		expect(collection.filter((one) => one.system === 'base16').length).toBeGreaterThan(0);
	});

	it('is in one order, by name', () => {
		const order = collection.map((one) => `${one.name.toLowerCase()}\u0000${one.slug}`);
		expect(order).toEqual([...order].sort());
	});

	it('carries six-digit hex for every one of the sixteen', () => {
		for (const scheme of collection) {
			for (const key of BASE_KEYS) {
				expect(scheme.palette[key], `${scheme.slug} ${key}`).toMatch(/^#[0-9a-f]{6}$/);
			}
		}
	});

	it('names every scheme once, as something a saved look can hold', () => {
		const slugs = collection.map((one) => one.slug);
		expect(new Set(slugs).size).toBe(slugs.length);
		for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/);
	});

	it('is read once and answered by slug', async () => {
		expect(await schemes()).toBe(collection);
		expect(await schemeBySlug(collection[0].slug)).toBe(collection[0]);
		expect(await schemeBySlug('nothing-is-called-this')).toBeNull();
	});
});

/**
 * The most contrast one colour can carry against EVERY one of these surfaces at
 * once. A lift runs to an end of the ramp, so surfaces all on one side of a mark
 * are answered there; ones that straddle it are answered at a crossing between
 * two NEIGHBOURS, where the colour is as far from each as it can be from both
 * and every further surface is further still.
 */
function bestOnAll(...surfaces: readonly Oklch[]): number {
	const luminance = (one: Oklch): number => 1.05 / contrastRatio(one, { l: 1, c: 0, h: 0 }) - 0.05;
	const ramp = surfaces.map(luminance).sort((x, y) => x - y);
	const crossings = ramp.slice(1).map((on, at) => Math.sqrt((on + 0.05) / (ramp[at] + 0.05)));
	return Math.max((ramp[0] + 0.05) / 0.05, 1.05 / (ramp[ramp.length - 1] + 0.05), ...crossings);
}

describe('what the picker offers', () => {
	// Flip this row when the collection is re-vendored or the mapping moves, and
	// say what moved: the count is the one thing a sweep of passing assertions
	// cannot show, because a mapping that shuts half the collection out passes
	// every floor below it.
	it('is most of the collection', () => {
		expect(dressed).toHaveLength(500);
		expect(skipped).toHaveLength(71);
	});

	it('leaves out only what cannot carry what a person reads', () => {
		const why = { ink: 0, line: 0, rest: 0 };
		for (const scheme of skipped) {
			const paper = colour(scheme.palette.base00);
			if (contrastRatio(colour(scheme.palette.base05), paper) < TEXT_FLOOR) {
				why.ink += 1;
			} else if (
				bestOnAll(paper, colour(scheme.palette.base01), colour(scheme.palette.base02)) < TEXT_FLOOR
			) {
				// Its own ink reads on its own page; what it has nowhere to put is
				// the secondary line, read on all three of its surfaces.
				why.line += 1;
			} else {
				// Nothing in the collection reaches here: a scheme with nowhere to
				// stand its eight slots, or its alarm, has nowhere for the secondary
				// line either, so the line accounts for it first.
				why.rest += 1;
			}
		}
		expect(why).toEqual({ ink: 44, line: 27, rest: 0 });
	});

	it('is what legible() answers for, scheme by scheme', () => {
		const offered = new Set(dressed.map(({ scheme }) => scheme.slug));
		for (const scheme of collection) {
			expect(legible(scheme), scheme.slug).toBe(offered.has(scheme.slug));
		}
	});

	// The picker dresses the scheme on the person when it mounts and the whole
	// collection when it opens, on a phone, in a webview.
	it('is dressed once per scheme and the answer kept', () => {
		for (const scheme of collection.slice(0, 8)) {
			expect(dressOnce(scheme), scheme.slug).toBe(dressOnce(scheme));
			expect(dressOnce(scheme), scheme.slug).toEqual(dress(scheme));
		}
	});
});

describe('a dressing', () => {
	it('carries every token a theme block declares', () => {
		for (const { dressing } of dressed) {
			for (const token of DRESSED_TOKENS) {
				expect(dressing.tokens[token], `${dressing.slug} ${token}`).toMatch(/^#[0-9a-f]{6}$/);
			}
		}
	});

	it('leaves every token another axis owns alone', () => {
		for (const { dressing } of dressed) {
			for (const token of UNDRESSED_TOKENS) {
				expect(dressing.tokens[token], `${dressing.slug} ${token}`).toBeUndefined();
			}
		}
	});

	it('stays inside the bound the store and the boot scripts hold it to', () => {
		for (const { dressing } of dressed) {
			for (const [token, paint] of Object.entries(dressing.tokens)) {
				expect(token, dressing.slug).toMatch(TOKEN_NAME);
				expect(paint, `${dressing.slug} ${token}`).toMatch(TOKEN_VALUE);
				expect(paint, `${dressing.slug} ${token}`).not.toMatch(/url\(/i);
			}
		}
	});

	it('carries the scheme the slug names, and which way its own ground runs', () => {
		for (const { scheme, dressing } of dressed) {
			expect(dressing.slug).toBe(scheme.slug);
			expect(dressing.variant).toBe(scheme.variant);
		}
	});

	// A surface from one scheme beside an ink from another is what a shared
	// mutable palette would produce, and it would read as a near miss rather
	// than as a defect.
	it('paints nothing the scheme itself does not state, bar what it works out', () => {
		for (const { scheme, dressing } of dressed) {
			const own = Object.values(scheme.palette);
			for (const [token, paint] of Object.entries(dressing.tokens)) {
				if (DERIVED.has(token)) continue;
				expect(own, `${dressing.slug} ${token}`).toContain(paint);
			}
		}
	});
});

describe('what a person reads a scheme by', () => {
	it('reads at AA on the surface it lands on, every one of them', () => {
		for (const { dressing } of dressed) {
			for (const [token, surface] of INKS) {
				expect(
					contrastRatio(painted(dressing, token), painted(dressing, surface)),
					`${dressing.slug} ${token} on ${surface}`
				).toBeGreaterThanOrEqual(TEXT_FLOOR);
			}
		}
	});

	it("is the scheme's own ink, lifted only where its own surface swallows it", () => {
		for (const { scheme, dressing } of dressed) {
			expect(dressing.tokens['--foreground']).toBe(scheme.palette.base05);
			const ink = painted(dressing, '--foreground');
			for (const [token, surface] of INKS.filter(([one]) => FROM_INK.has(one))) {
				const on = painted(dressing, surface);
				if (contrastRatio(ink, on) >= TEXT_FLOOR) {
					expect(dressing.tokens[token], `${dressing.slug} ${token}`).toBe(
						dressing.tokens['--foreground']
					);
					continue;
				}
				expect(
					Math.abs(painted(dressing, token).l - on.l),
					`${dressing.slug} ${token}`
				).toBeGreaterThan(Math.abs(ink.l - on.l));
			}
		}
	});

	it("draws a destructive act in the scheme's own alarm, lifted like every other ink", () => {
		for (const { scheme, dressing } of dressed) {
			const own = colour(scheme.palette.base08);
			const alarm = painted(dressing, '--destructive');
			const surfaces = ['--background', '--card', '--muted'].map((on) => painted(dressing, on));
			if (surfaces.every((on) => contrastRatio(own, on) >= TEXT_FLOOR)) {
				expect(dressing.tokens['--destructive'], dressing.slug).toBe(scheme.palette.base08);
			}
			expect(alarm.c, `${dressing.slug} alarm chroma`).toBeLessThanOrEqual(own.c + 0.005);
			const ends = [painted(dressing, '--background'), painted(dressing, '--foreground')];
			const on = painted(dressing, '--destructive-foreground');
			expect(ends, dressing.slug).toContainEqual(on);
			expect(contrastRatio(on, alarm), dressing.slug).toBe(
				Math.max(...ends.map((end) => contrastRatio(end, alarm)))
			);
		}
	});
});

describe('the surfaces under what a person reads', () => {
	it("draws a field's boundary where it can be seen, in the scheme's own field colour", () => {
		let lifted = 0;
		for (const { scheme, dressing } of dressed) {
			const field = painted(dressing, '--input');
			const page = painted(dressing, '--background');
			expect(
				contrastRatio(field, page),
				`${dressing.slug} input on the page`
			).toBeGreaterThanOrEqual(EDGE_FLOOR);
			const own = colour(scheme.palette.base03);
			if (contrastRatio(own, page) >= EDGE_FLOOR) {
				expect(dressing.tokens['--input'], dressing.slug).toBe(scheme.palette.base03);
				continue;
			}
			lifted += 1;
			expect(field.c, `${dressing.slug} input chroma`).toBeLessThanOrEqual(own.c + 0.005);
			expect(field.l, `${dressing.slug} input lightness`).not.toBe(own.l);
		}
		// The count is what a sweep of passing floors cannot show: a boundary
		// lifted on every scheme would be the scheme's edge nowhere.
		expect(lifted).toBe(10);
	});

	it('gives a highlighted row a surface of its own, off every surface beside it', () => {
		for (const { dressing } of dressed) {
			const spot = painted(dressing, '--accent');
			for (const beside of ['--muted', '--secondary', '--card', '--popover']) {
				expect(dressing.tokens['--accent'], `${dressing.slug} accent is ${beside}`).not.toBe(
					dressing.tokens[beside as `--${string}`]
				);
				expect(
					distance(spot, painted(dressing, beside)),
					`${dressing.slug} accent beside ${beside}`
				).toBeGreaterThanOrEqual(SURFACE_STEP);
			}
			// Further from the page than the muted surface, the way every theme in
			// app.css draws its own highlight.
			const page = painted(dressing, '--background').l;
			expect(Math.abs(spot.l - page), `${dressing.slug} accent depth`).toBeGreaterThan(
				Math.abs(painted(dressing, '--muted').l - page)
			);
		}
	});
});

describe('the eight hues a tag borrows', () => {
	it('is declared on one chroma and eight hues in app.css', () => {
		expect([...DECLARED.keys()].sort((a, b) => a - b)).toEqual(SLOTS);
		for (const [slot, declared] of DECLARED) {
			for (const one of declared) {
				expect(one.h, `slot ${slot} hue`).toBe(declared[0].h);
				expect(one.c, `slot ${slot} chroma`).toBe(declared[0].c);
			}
		}
	});

	it('clears the floor a mark owes, on the surfaces a mark is drawn on', () => {
		for (const { dressing } of dressed) {
			for (const slot of SLOTS) {
				const facet = painted(dressing, `--facet-${slot}`);
				for (const surface of ['--background', '--card']) {
					expect(
						contrastRatio(facet, painted(dressing, surface)),
						`${dressing.slug} facet ${slot} on ${surface}`
					).toBeGreaterThanOrEqual(MARK_FLOOR);
				}
			}
		}
	});

	it('keeps every pair apart, so eight questions read as eight', () => {
		for (const { dressing } of dressed) {
			const slots = SLOTS.map((slot) => painted(dressing, `--facet-${slot}`));
			for (let i = 0; i < slots.length; i++) {
				for (let j = i + 1; j < slots.length; j++) {
					expect(
						distance(slots[i], slots[j]),
						`${dressing.slug} slots ${i + 1} and ${j + 1}`
					).toBeGreaterThanOrEqual(SLOT_SEPARATION);
				}
			}
		}
	});

	// The same rule `token-contrast.test.ts` holds a theme to: lightness carries
	// depth on the canvas, so the eight may not spend it on each other.
	it('spends lightness on depth alone, so every slot shares one', () => {
		for (const { dressing } of dressed) {
			const lightnesses = SLOTS.map((slot) => painted(dressing, `--facet-${slot}`).l);
			for (const l of lightnesses) {
				expect(Math.abs(l - lightnesses[0]), dressing.slug).toBeLessThan(0.02);
			}
		}
	});

	it('runs in hue order, slot by slot, once round the circle', () => {
		for (const { dressing } of dressed) {
			const hues = paintedHues(dressing);
			// Counted round the circle rather than along a sorted list: a ring whose
			// first slot lands a fraction below zero paints a hue near 360.
			const backwards = hues.filter((hue, at) => hue > hues[(at + 1) % hues.length]);
			expect(backwards, dressing.slug).toHaveLength(1);
		}
	});

	// The count is the other thing a sweep of passing floors cannot show: a
	// mapping that answered every scheme with the same eight hues would clear
	// every assertion above it.
	it('is the hues the scheme drew, opened where it drew two of them too close', () => {
		const reach = { itsOwn: 0, under5: 0, under30: 0, beyond: 0 };
		let worst = 0;
		for (const { scheme, dressing } of dressed) {
			if (borrows(scheme, dressing)) continue;
			const moved = openedBy(scheme, dressing);
			worst = Math.max(worst, moved);
			if (moved < 1) reach.itsOwn += 1;
			else if (moved < 5) reach.under5 += 1;
			else if (moved < 30) reach.under30 += 1;
			else reach.beyond += 1;
		}
		expect(reach).toEqual({ itsOwn: 86, under5: 76, under30: 312, beyond: 18 });
		// A crowded pair is opened to the gap its chroma demands and no further, so
		// no slot is carried round the circle to get there.
		expect(worst).toBeLessThan(150);
	});

	// A scheme that asked one question eight times keeps its own sixteen colours
	// in the picker and borrows Sloppy's hues for the canvas.
	it("is Sloppy's own only where a scheme has one hue in its eight, or none", () => {
		const borrowing = dressed.filter(({ scheme, dressing }) => borrows(scheme, dressing));
		expect(borrowing.map(({ scheme }) => scheme.slug)).toEqual([
			'base16-berlin',
			'base24-berlin',
			'base16-grayscale-dark',
			'base16-grayscale-light',
			'base16-greenscreen',
			'base16-london',
			'base24-london',
			'base16-sequoia-monochrome-light'
		]);
		const why = { noHue: 0, oneHue: 0 };
		for (const { scheme, dressing } of borrowing) {
			for (const slot of SLOTS) {
				const facet = painted(dressing, `--facet-${slot}`);
				expect(facet.c, `${scheme.slug} slot ${slot} chroma`).toBeLessThanOrEqual(
					declaredAt(slot).c + 0.005
				);
			}
			const own = ownHues(scheme);
			if (own.every((one) => one.c <= NEUTRAL_CHROMA)) {
				why.noHue += 1;
				continue;
			}
			const hues = own.map((one) => one.h);
			expect(Math.max(...hues) - Math.min(...hues), scheme.slug).toBeLessThan(6);
			why.oneHue += 1;
		}
		expect(why).toEqual({ noHue: 6, oneHue: 2 });
	});
});
