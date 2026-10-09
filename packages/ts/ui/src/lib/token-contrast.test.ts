/**
 * The file of record for DESIGN.md § "Contrast is measured, not assumed".
 *
 * It sweeps every look Sloppy writes itself — its surfaces, its accent and its
 * facet slots — reading the tokens out of `app.css` rather than from a second
 * table: a table beside the stylesheet is a copy that drifts, and a palette
 * whose slots have converged passes every contrast check while having quietly
 * stopped being a language. A look carried as data brings its own surfaces and
 * its own accent, which this file cannot see: `dress.test.ts` sweeps those
 * against the collection, and what `app.css` owes one with no paint in hand is
 * held here.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TAG_HUE_SLOTS } from '@sloppy/types';
import { contrastRatio, oklabDistance, parseOklch, type Oklch } from './internal/color.js';

const CSS = readFileSync(new URL('./app.css', import.meta.url), 'utf8').replace(
	/\/\*[\s\S]*?\*\//g,
	''
);

const LOOKS = ['paper', 'graphite', 'light', 'dark', 'contrast'] as const;
const DARK_LOOKS = new Set<string>(['graphite', 'dark']);
/** A look carried as data: `data-look` holds its id and no block here names it,
 *  so what the stylesheet still owes it is measured under its own id. */
const CARRIED = 'a-look-carried-as-data';
const FACET_SLOTS = [
	...new Set([...CSS.matchAll(/--facet-(\d+)\s*:/g)].map((slot) => Number(slot[1])))
].sort((a, b) => a - b);

type Look = (typeof LOOKS)[number] | typeof CARRIED;

interface Rule {
	selectors: string[];
	declarations: Map<string, string>;
	order: number;
}

/** Innermost blocks only, which is what makes nesting (`@layer`, `@media`) fall
 *  out for free: a body containing a brace cannot match. */
function rules(): Rule[] {
	const out: Rule[] = [];
	const block = /([^{}]+)\{([^{}]*)\}/g;
	let match: RegExpExecArray | null;
	let order = 0;
	while ((match = block.exec(CSS)) !== null) {
		const selectors = match[1]
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		if (!selectors.some((s) => s.includes(':root'))) continue;
		const declarations = new Map<string, string>();
		for (const decl of match[2].split(';')) {
			const colon = decl.indexOf(':');
			if (colon < 0) continue;
			const name = decl.slice(0, colon).trim();
			if (name.startsWith('--')) declarations.set(name, decl.slice(colon + 1).trim());
		}
		out.push({ selectors, declarations, order: order++ });
	}
	return out;
}

const ATTRIBUTE = /\[data-(look|style)='([^']+)'\]/g;

/**
 * Whether one selector applies to a plain `<html>` carrying exactly this look,
 * on a ground running this way. A selector using `:not()` is skipped rather
 * than modelled — each one in `app.css` shares its declaration body with a
 * positive twin that is matched here, so nothing goes unmeasured.
 */
function matches(selector: string, look: Look, dark: boolean): boolean {
	if (!selector.includes(':root')) return false;
	if (selector.includes(':not(')) return false;
	if (selector.includes('.dark') && !dark) return false;
	for (const [, axis, value] of selector.matchAll(ATTRIBUTE)) {
		if (axis === 'look' && value !== look) return false;
		// Only the default style is swept: `data-style` may not touch a palette
		// token, so a style block has nothing here to measure.
		if (axis === 'style') return false;
	}
	return true;
}

/** Classes, attributes and pseudo-classes — the only column that varies here. */
function weight(selector: string): number {
	return (selector.match(/\.[\w-]+|\[[^\]]+\]|(?<!:):[\w-]+/g) ?? []).length;
}

const ALL_RULES = rules();

function tokens(look: Look, dark = DARK_LOOKS.has(look)): Map<string, string> {
	const applicable = ALL_RULES.flatMap((rule) => {
		const weights = rule.selectors.filter((s) => matches(s, look, dark)).map(weight);
		return weights.length
			? [{ weight: Math.max(...weights), order: rule.order, declarations: rule.declarations }]
			: [];
	}).sort((a, b) => a.weight - b.weight || a.order - b.order);

	const resolved = new Map<string, string>();
	for (const rule of applicable) {
		for (const [name, value] of rule.declarations) resolved.set(name, value);
	}
	return resolved;
}

/** Follows `var(--x)` indirection, which is how a token points at another. */
function color(resolved: Map<string, string>, name: string): Oklch {
	let value = resolved.get(name);
	for (let hop = 0; value && hop < 8; hop++) {
		const indirect = /^var\((--[\w-]+)\)$/.exec(value);
		if (!indirect) break;
		value = resolved.get(indirect[1]);
	}
	const parsed = value ? parseOklch(value) : null;
	if (!parsed) throw new Error(`${name} does not resolve to an oklch() literal (${value})`);
	return parsed;
}

/** A mark is drawn on all three surfaces, and a card is the one that costs a
 *  lightened mark its contrast on a dark look. */
const SURFACES = ['--background', '--card', '--popover'] as const;

function onSurfaces(resolved: Map<string, string>, name: string): number {
	const mark = color(resolved, name);
	return Math.min(...SURFACES.map((s) => contrastRatio(mark, color(resolved, s))));
}

/** What a line carrying meaning on its own owes — WCAG 1.4.11. */
const NON_TEXT_FLOOR = 3;

describe('token contrast', () => {
	it('reads the tokens out of app.css', () => {
		expect(ALL_RULES.length).toBeGreaterThan(8);
		expect(color(tokens('paper'), '--background').l).toBeCloseTo(0.972, 3);
	});

	it('paints exactly the slots a selected tag can borrow', () => {
		expect(FACET_SLOTS).toEqual([...TAG_HUE_SLOTS]);
	});

	it.each(LOOKS)('%s: ink on paper is legible body text', (look) => {
		const resolved = tokens(look);
		expect(
			contrastRatio(color(resolved, '--foreground'), color(resolved, '--background'))
		).toBeGreaterThanOrEqual(7);
	});

	// DESIGN.md § "What a look names": muted is 0.035 L off the surface toward
	// the ink.
	it.each(LOOKS)('%s: muted is one step off the surface, toward the ink', (look) => {
		const resolved = tokens(look);
		const surface = color(resolved, '--background').l;
		const toward = color(resolved, '--foreground').l > surface ? 0.035 : -0.035;
		expect(color(resolved, '--muted').l).toBeCloseTo(surface + toward, 3);
	});

	// `input.svelte` draws a text field as `border-input bg-background`, so the
	// boundary is the whole of what identifies the control. Naming the floor it
	// stands under makes raising it a decision taken here — flip this row then.
	it.each(LOOKS)('%s: the control boundary stands under the floor', (look) => {
		expect(onSurfaces(tokens(look), '--input')).toBeLessThan(NON_TEXT_FLOOR);
	});

	it.each(LOOKS)('%s: secondary text clears AA on the page and on muted', (look) => {
		const resolved = tokens(look);
		const dim = color(resolved, '--muted-foreground');
		expect(contrastRatio(dim, color(resolved, '--background'))).toBeGreaterThanOrEqual(4.5);
		expect(contrastRatio(dim, color(resolved, '--muted'))).toBeGreaterThanOrEqual(4.5);
	});

	// DESIGN.md § Hue: a node fill carrying meaning alone is a graphical object.
	describe.each(LOOKS)('%s facets', (look) => {
		const resolved = tokens(look);

		it.each(FACET_SLOTS)('slot %i clears 3:1 on every surface', (slot) => {
			expect(onSurfaces(resolved, `--facet-${slot}`)).toBeGreaterThanOrEqual(NON_TEXT_FLOOR);
		});

		it('keeps every pair of slots at least 0.03 apart in OKLab', () => {
			const slots = FACET_SLOTS.map((slot) => color(resolved, `--facet-${slot}`));
			for (let i = 0; i < slots.length; i++) {
				for (let j = i + 1; j < slots.length; j++) {
					expect(oklabDistance(slots[i], slots[j])).toBeGreaterThanOrEqual(0.03);
				}
			}
		});

		it('spends lightness on depth alone, so every slot shares one', () => {
			const lightnesses = new Set(FACET_SLOTS.map((slot) => color(resolved, `--facet-${slot}`).l));
			expect(lightnesses.size).toBe(1);
		});
	});

	// DESIGN.md § "The context as a bar": the bar outlines its track and leaves
	// what is unspent as the page, because a band on muted does not clear the
	// floor everywhere. Flip this row the day the palette lets it be filled.
	it('keeps a slot off muted, which is why the context bar fills the page', () => {
		const worst = Math.min(
			...LOOKS.flatMap((look) => {
				const resolved = tokens(look);
				return FACET_SLOTS.map((slot) =>
					contrastRatio(color(resolved, `--facet-${slot}`), color(resolved, '--muted'))
				);
			})
		);
		expect(worst).toBeLessThan(NON_TEXT_FLOOR);
		expect(worst).toBeCloseTo(2.89, 2);
	});

	// DESIGN.md § "The look": the accent is the look's, so every look answers for
	// its own mark, its own ring and the words on its own fill.
	describe.each(LOOKS)('%s accent', (look) => {
		it('draws a mark that clears 3:1 on every surface', () => {
			expect(onSurfaces(tokens(look), '--primary-mark')).toBeGreaterThanOrEqual(NON_TEXT_FLOOR);
		});

		// The focus ring is the only thing saying where a keyboard reader stands.
		it('draws a focus ring that clears 3:1 on every surface', () => {
			expect(onSurfaces(tokens(look), '--ring')).toBeGreaterThanOrEqual(NON_TEXT_FLOOR);
		});

		it('carries readable text on its own fill', () => {
			const resolved = tokens(look);
			expect(
				contrastRatio(color(resolved, '--primary'), color(resolved, '--primary-foreground'))
			).toBeGreaterThanOrEqual(4.5);
		});
	});

	// A look carried as data brings its own accent with its own surfaces
	// (`dress.test.ts`), so what `app.css` still owes one is the ground to stand
	// on until its paint is in hand: the family of Sloppy's own look on the same
	// ground, measured with that look above.
	describe('a look with no paint in hand falls back to the accent of its own ground', () => {
		const FAMILY = ['--primary', '--primary-foreground', '--primary-mark', '--ring'] as const;

		it('on a dark ground reads as it does on Graphite', () => {
			const carried = tokens(CARRIED, true);
			const graphite = tokens('graphite');
			for (const token of FAMILY) expect(color(carried, token)).toEqual(color(graphite, token));
		});

		it('on a light ground reads as it does on Paper', () => {
			const carried = tokens(CARRIED, false);
			const paper = tokens('paper');
			for (const token of FAMILY) expect(color(carried, token)).toEqual(color(paper, token));
		});
	});
});
