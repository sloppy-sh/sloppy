/**
 * The file of record for DESIGN.md § Layout's density axis: what a compact
 * device gives up, what it never gives up, and that comfortable is the absent
 * attribute rather than a value of its own.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(new URL('./app.css', import.meta.url), 'utf8').replace(
	/\/\*[\s\S]*?\*\//g,
	''
);

/** The declarations of the first block whose selector line matches. */
function declarations(after: string, selector: string): Map<string, string> {
	const from = after === '' ? 0 : CSS.indexOf(after);
	expect(from).toBeGreaterThanOrEqual(0);
	const start = CSS.indexOf(selector, from);
	if (start < 0) throw new Error(`no ${selector} block in app.css`);
	const body = CSS.slice(CSS.indexOf('{', start) + 1, CSS.indexOf('}', start));
	const out = new Map<string, string>();
	for (const decl of body.split(';')) {
		const colon = decl.indexOf(':');
		if (colon < 0) continue;
		out.set(decl.slice(0, colon).trim(), decl.slice(colon + 1).trim());
	}
	return out;
}

const rem = (value: string) => Number(value.replace('rem', ''));

describe('how close everything is drawn', () => {
	it('is comfortable where nothing says otherwise, and says it in one place', () => {
		const bare = declarations('', ':root {');
		expect(rem(bare.get('--control') ?? '')).toBe(2.75);
		// Absent IS comfortable: nothing keys off a `comfortable` value.
		expect(CSS).not.toContain("data-density='comfortable'");
	});

	it('draws a compact device closer, and its targets are what give most', () => {
		const bare = declarations('', ':root {');
		const compact = declarations('', ":root[data-density='compact']");
		expect(rem(compact.get('--control') ?? '')).toBeLessThan(rem(bare.get('--control') ?? ''));
		expect(rem(compact.get('--spacing') ?? '0.25')).toBeLessThan(0.25);
	});

	// An icon is counted in `--spacing` too, and one much under 14px stops
	// reading as what it is.
	it('never shrinks an icon below what can be read', () => {
		const compact = declarations('', ":root[data-density='compact']");
		const icon = rem(compact.get('--spacing') ?? '') * 4 * 16;
		expect(icon).toBeGreaterThanOrEqual(14);
	});

	it('gives a finger its full target back wherever one is used', () => {
		const floor = declarations(
			'@media (hover: none) and (pointer: coarse)',
			":root[data-density='compact']"
		);
		const bare = declarations('', ':root {');
		expect(floor.get('--control')).toBe(bare.get('--control'));
		expect(rem(floor.get('--control') ?? '') * 16).toBeGreaterThanOrEqual(44);
		expect(floor.get('--spacing')).toBe('0.25rem');
	});

	it('counts a target in a token rather than a number, so nothing spells 44px itself', () => {
		expect(CSS).toContain('--spacing-control: var(--control)');
	});
});
