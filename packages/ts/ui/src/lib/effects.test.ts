// DESIGN.md § "The effect axis" is the doc of record: an effect is a texture
// nothing can land on, it names no colour of its own, and its motion goes where
// the reader has asked for less of it. Every screen is held to all of it, so a
// new one cannot ship with half.

import { EFFECTS } from '@sloppy/types';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SHEET = readFileSync(new URL('./effects.css', import.meta.url), 'utf8');
const CSS = SHEET.replace(/\/\*[\s\S]*?\*\//g, '');

/** The screens that are a texture: every one but plain, which is the absence. */
const TEXTURES = EFFECTS.filter((effect) => effect !== 'none');

/** The declarations of the block at `selector`, from `after`. */
function declarations(after: string, selector: string): Map<string, string> {
	const from = after === '' ? 0 : CSS.indexOf(after);
	expect(from).toBeGreaterThanOrEqual(0);
	const start = CSS.indexOf(selector, from);
	if (start < 0) throw new Error(`no ${selector} block in effects.css`);
	const body = CSS.slice(CSS.indexOf('{', start) + 1, CSS.indexOf('}', start));
	const out = new Map<string, string>();
	for (const decl of body.split(';')) {
		const colon = decl.indexOf(':');
		if (colon < 0) continue;
		out.set(decl.slice(0, colon).trim(), decl.slice(colon + 1).trim());
	}
	return out;
}

/** Everything one screen declares, over however many blocks it takes. */
function rulesFor(effect: string): string {
	return [...CSS.matchAll(new RegExp(`:root\\[data-effect='${effect}'\\][^{]*\\{([^}]*)\\}`, 'g'))]
		.map((found) => found[1])
		.join(' ');
}

/** The one block every screen is drawn in. */
const OVERLAY = ':root[data-effect] body::after';
/** The highest the app's own chrome stacks: a dock filling the page,
 *  `side-dock.svelte` (`60 + stack`, the chat dock at stack 1). */
const CHROME_CEILING = 61;

describe('the screen a page is drawn on', () => {
	it('is plain where nothing says otherwise, and says it in one place', () => {
		expect(CSS).toContain(OVERLAY);
		// Absent IS plain: nothing keys off a value of its own for it.
		expect(CSS).not.toContain("data-effect='plain'");
		expect(CSS).not.toContain("data-effect='none'");
	});

	it('lays every screen over everything and lets every tap through it', () => {
		const overlay = declarations('', OVERLAY);
		expect(overlay.get('pointer-events')).toBe('none');
		expect(overlay.get('position')).toBe('fixed');
		expect(Number(overlay.get('z-index'))).toBeGreaterThan(CHROME_CEILING);
	});

	it.each(TEXTURES)('shows %s as itself, from the rules the page wears', (effect) => {
		// The sample is not a second copy: every block that dresses the page in a
		// screen dresses a sample in it too, in the same selector list.
		for (const block of CSS.matchAll(
			new RegExp(`([^}]*):root\\[data-effect='${effect}'\\]([^{]*)\\{`, 'g')
		)) {
			const selectors = `${block[1].split('}').at(-1) ?? ''}:root[data-effect='${effect}']${block[2]}`;
			expect(selectors).toContain(`[data-screen='${effect}']`);
		}
		expect(CSS).toContain(`[data-screen='${effect}']`);
	});

	it('lets a sample carry its screen without laying it over anything else', () => {
		const sample = declarations('', '[data-screen]::after');
		expect(sample.get('position')).toBe('absolute');
		expect(sample.get('pointer-events')).toBe('none');
		expect(declarations('', '[data-screen] {').get('overflow')).toBe('hidden');
	});

	it.each(TEXTURES)('draws %s as a texture of its own', (effect) => {
		const rules = rulesFor(effect);
		expect(rules.trim()).not.toBe('');
		// A texture, not a shape: what each screen says is how the page is
		// covered, never where anything sits.
		for (const laying of ['position', 'inset', 'width', 'height', 'margin', 'padding']) {
			expect(rules).not.toMatch(new RegExp(`(^|[;\\s])${laying}\\s*:`));
		}
	});

	// DESIGN.md § "The effect axis": an effect mixes from the theme's ink, so it
	// composes with every look.
	it('names no colour of its own', () => {
		expect(CSS).not.toMatch(/#[0-9a-f]{3,8}\b/i);
		expect(CSS).not.toMatch(/\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\(/);
		expect(CSS).not.toMatch(
			/\b(?:white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|silver|navy|teal|olive|maroon|aqua|fuchsia|lime)\b/
		);
		for (const effect of TEXTURES) expect(rulesFor(effect)).toContain('var(--foreground)');
	});

	it('stops moving where the reader has asked for less motion', () => {
		const still = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
		expect(still).not.toBe('');
		for (const effect of TEXTURES) {
			if (!/animation:/.test(rulesFor(effect))) continue;
			expect(still).toContain(`data-effect='${effect}'`);
			expect(still).toMatch(/animation:\s*none/);
		}
	});
});

// DESIGN.md § "The effect axis": held to no floor, bounded instead — these are
// the bounds the doc promises, read off the rules.
describe('how much of the ink a screen takes', () => {
	const shares = (text: string): number[] =>
		[...text.matchAll(/var\(--foreground\)\s+(\d+(?:\.\d+)?)%/g)].map((one) => Number(one[1]));

	it('never more than a fifth anywhere, and never more than 14% over the page', () => {
		const everywhere = shares(SHEET);
		expect(everywhere.length).toBeGreaterThan(0);
		for (const share of everywhere) expect(share).toBeLessThanOrEqual(20);

		for (const over of SHEET.matchAll(/body::after[^{]*\{([^}]*)\}/g)) {
			for (const share of shares(over[1])) expect(share).toBeLessThanOrEqual(14);
		}
	});
});
