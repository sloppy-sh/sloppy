// DESIGN.md § "The effect axis" is the doc of record: an effect is a texture
// nothing can land on, it names no colour of its own, and its motion goes where
// the reader has asked for less of it.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(new URL('./effects.css', import.meta.url), 'utf8').replace(
	/\/\*[\s\S]*?\*\//g,
	''
);

/** The declarations of the first block whose selector line matches, from `after`. */
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

const OVERLAY = ":root[data-effect='crt'] body::after";
/** The highest the app's own chrome stacks, which the screen is in front of. */
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

	it('lays the tube over everything and lets every tap through it', () => {
		const overlay = declarations('', OVERLAY);
		expect(overlay.get('pointer-events')).toBe('none');
		expect(overlay.get('position')).toBe('fixed');
		expect(Number(overlay.get('z-index'))).toBeGreaterThan(CHROME_CEILING);
	});

	// DESIGN.md § "The effect axis": an effect mixes from the theme's ink, so it
	// composes with every theme and with every scheme.
	it('names no colour of its own', () => {
		expect(CSS).not.toMatch(/#[0-9a-f]{3,8}\b/i);
		expect(CSS).not.toMatch(/\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\(/);
		expect(CSS).not.toMatch(
			/\b(?:white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|silver|navy|teal|olive|maroon|aqua|fuchsia|lime)\b/
		);
		expect(CSS).toContain('var(--foreground)');
	});

	it('stops flickering where the reader has asked for less motion', () => {
		const overlay = declarations('', OVERLAY);
		expect(overlay.get('animation')).toBeDefined();
		const quiet = declarations('@media (prefers-reduced-motion: reduce)', OVERLAY);
		expect(quiet.get('animation')).toBe('none');
	});
});

// DESIGN.md § "The effect axis": held to no floor, bounded instead — these are
// the bounds the doc promises, read off the rules.
describe('how much of the ink the screen takes', () => {
	const SHEET = readFileSync(new URL('./effects.css', import.meta.url), 'utf8');
	const shares = (text: string): number[] =>
		[...text.matchAll(/var\(--foreground\)\s+(\d+(?:\.\d+)?)%/g)].map((one) => Number(one[1]));

	it('never more than a fifth anywhere, and never more than 14% in the overlay', () => {
		const everywhere = shares(SHEET);
		expect(everywhere.length).toBeGreaterThan(0);
		for (const share of everywhere) expect(share).toBeLessThanOrEqual(20);

		const at = SHEET.indexOf('body::after');
		expect(at).toBeGreaterThan(-1);
		const overlay = SHEET.slice(at, SHEET.indexOf('}', at));
		for (const share of shares(overlay)) expect(share).toBeLessThanOrEqual(14);
	});
});
