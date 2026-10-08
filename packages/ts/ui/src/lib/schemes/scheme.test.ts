/**
 * The file of record for the dressing contract — DESIGN.md § Schemes. A
 * dressing is read against `app.css` rather than against a second list: the
 * tokens a theme block declares are what a scheme has to answer for, and a
 * theme that grows one has to decide where a scheme gets it.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DRESSED_TOKENS, UNDRESSED_TOKENS } from './scheme.js';

function stylesheet(name: string): string {
	return readFileSync(new URL(`../${name}`, import.meta.url), 'utf8').replace(
		/\/\*[\s\S]*?\*\//g,
		''
	);
}

const CSS = stylesheet('app.css');

/** The Paper block carries bare `:root`, so what it declares is every theme
 *  token a scheme falls back to when a dressing is silent. */
function paperTokens(): string[] {
	const block = /:root,\s*:root\[data-theme='paper'\]\s*\{([^}]*)\}/.exec(CSS);
	if (!block) throw new Error('the Paper block is not where this test reads it');
	return [...block[1].matchAll(/(--[\w-]+)\s*:/g)].map((declaration) => declaration[1]);
}

describe('the dressing contract', () => {
	it('reads the Paper block out of app.css', () => {
		expect(paperTokens()).toContain('--background');
	});

	it('answers for every token a theme block declares', () => {
		const answered = new Set<string>([...DRESSED_TOKENS, ...UNDRESSED_TOKENS]);
		for (const token of paperTokens()) expect([...answered]).toContain(token);
	});

	it('leaves what it does not dress to the axis that owns it', () => {
		for (const token of UNDRESSED_TOKENS) {
			expect([...DRESSED_TOKENS]).not.toContain(token);
		}
	});

	// A dressing may not paint this one, so the rule handing a scheme its edge has
	// to be there — and ahead of the style axis, which has to beat it.
	it('is answered for --border by a rule a style can beat', () => {
		expect(stylesheet('schemes.css')).toMatch(
			/:root\[data-theme='scheme'\]\s*\{[^}]*--border:\s*var\(--input\)/
		);
		expect(CSS.indexOf("@import './schemes.css'")).toBeLessThan(
			CSS.indexOf(":root[data-style='hardline']")
		);
	});
});
