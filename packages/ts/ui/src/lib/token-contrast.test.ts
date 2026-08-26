/**
 * The file of record for DESIGN.md § "Contrast is measured, not assumed".
 *
 * It sweeps every theme × accent and every theme × facet-slot pairing, reading
 * the tokens out of `app.css` itself rather than from a second table — a table
 * beside the stylesheet is a copy that drifts, and a palette whose slots have
 * converged passes every contrast check while having quietly stopped being a
 * language.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio, oklabDistance, parseOklch, type Oklch } from './internal/color.js';

const CSS = readFileSync(new URL('./app.css', import.meta.url), 'utf8').replace(
	/\/\*[\s\S]*?\*\//g,
	''
);

const THEMES = ['paper', 'graphite', 'light', 'dark', 'contrast'] as const;
const DARK_THEMES = new Set(['graphite', 'dark']);
const ACCENTS = ['indigo', 'moss', 'rust', 'sea', 'iris', 'ochre', 'slate'] as const;
const FACET_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

type Theme = (typeof THEMES)[number];
type Accent = (typeof ACCENTS)[number];

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

const ATTRIBUTE = /\[data-(theme|accent|style)='([^']+)'\]/g;

/**
 * Whether one selector applies to a plain `<html>` carrying exactly this theme
 * and accent. A selector using `:not()` is skipped rather than modelled — each
 * one in `app.css` shares its declaration body with a positive twin that is
 * matched here, so nothing goes unmeasured.
 */
function matches(selector: string, theme: Theme, accent: Accent): boolean {
	if (!selector.includes(':root') || selector.includes(':not(')) return false;
	if (selector.includes('.dark') && !DARK_THEMES.has(theme)) return false;
	for (const [, axis, value] of selector.matchAll(ATTRIBUTE)) {
		if (axis === 'theme' && value !== theme) return false;
		if (axis === 'accent' && value !== accent) return false;
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

function tokens(theme: Theme, accent: Accent): Map<string, string> {
	const applicable = ALL_RULES.flatMap((rule) => {
		const weights = rule.selectors.filter((s) => matches(s, theme, accent)).map(weight);
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
 *  lightened mark its contrast on a dark theme. */
const SURFACES = ['--background', '--card', '--popover'] as const;

function onSurfaces(resolved: Map<string, string>, name: string): number {
	const mark = color(resolved, name);
	return Math.min(...SURFACES.map((s) => contrastRatio(mark, color(resolved, s))));
}

describe('token contrast', () => {
	it('reads the tokens out of app.css', () => {
		expect(ALL_RULES.length).toBeGreaterThan(8);
		expect(color(tokens('paper', 'indigo'), '--background').l).toBeCloseTo(0.972, 3);
	});

	it.each(THEMES)('%s: ink on paper is legible body text', (theme) => {
		const resolved = tokens(theme, 'indigo');
		expect(
			contrastRatio(color(resolved, '--foreground'), color(resolved, '--background'))
		).toBeGreaterThanOrEqual(7);
	});

	// DESIGN.md § "Theme presets": muted is 0.035 L off the surface toward the ink.
	it.each(THEMES)('%s: muted is one step off the surface, toward the ink', (theme) => {
		const resolved = tokens(theme, 'indigo');
		const surface = color(resolved, '--background').l;
		const toward = color(resolved, '--foreground').l > surface ? 0.035 : -0.035;
		expect(color(resolved, '--muted').l).toBeCloseTo(surface + toward, 3);
	});

	it.each(THEMES)('%s: secondary text clears AA on the page and on muted', (theme) => {
		const resolved = tokens(theme, 'indigo');
		const dim = color(resolved, '--muted-foreground');
		expect(contrastRatio(dim, color(resolved, '--background'))).toBeGreaterThanOrEqual(4.5);
		expect(contrastRatio(dim, color(resolved, '--muted'))).toBeGreaterThanOrEqual(4.5);
	});

	// DESIGN.md § Hue: a node fill carrying meaning alone is a graphical object.
	describe.each(THEMES)('%s facets', (theme) => {
		const resolved = tokens(theme, 'indigo');

		it.each(FACET_SLOTS)('slot %i clears 3:1 on every surface', (slot) => {
			expect(onSurfaces(resolved, `--facet-${slot}`)).toBeGreaterThanOrEqual(3);
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

	describe.each(THEMES)('%s accents', (theme) => {
		it.each(ACCENTS)('%s draws a mark that clears 3:1 on every surface', (accent) => {
			expect(onSurfaces(tokens(theme, accent), '--primary-mark')).toBeGreaterThanOrEqual(3);
		});

		it.each(ACCENTS)('%s carries readable text on its own fill', (accent) => {
			const resolved = tokens(theme, accent);
			expect(
				contrastRatio(color(resolved, '--primary'), color(resolved, '--primary-foreground'))
			).toBeGreaterThanOrEqual(4.5);
		});
	});
});
