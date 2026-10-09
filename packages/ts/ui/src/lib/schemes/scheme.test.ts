/**
 * The file of record for the dressing contract — DESIGN.md § "The look". A
 * look carried as data is read against `app.css` rather than against a second
 * list: the tokens a look block declares are what it has to answer for, and a
 * look block that grows one has to decide where a carried look gets it.
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

/** The Paper block carries bare `:root`, so what it declares is every token a
 *  look carried as data falls back to when its paint is silent. */
function paperTokens(): string[] {
	const block = /:root,\s*:root\[data-look='paper'\]\s*\{([^}]*)\}/.exec(CSS);
	if (!block) throw new Error('the Paper block is not where this test reads it');
	return [...block[1].matchAll(/(--[\w-]+)\s*:/g)].map((declaration) => declaration[1]);
}

describe('the dressing contract', () => {
	it('reads the Paper block out of app.css', () => {
		expect(paperTokens()).toContain('--background');
	});

	it('answers for every token a look block declares', () => {
		const answered = new Set<string>([...DRESSED_TOKENS, ...UNDRESSED_TOKENS]);
		for (const token of paperTokens()) expect([...answered]).toContain(token);
	});

	it('leaves what it does not dress to the axis that owns it', () => {
		for (const token of UNDRESSED_TOKENS) {
			expect([...DRESSED_TOKENS]).not.toContain(token);
		}
	});

	// A dressing may not paint this one, so the rule handing a carried look its
	// edge has to be there — and ahead of the style axis, which has to beat it.
	it('is answered for --border by a rule a style can beat', () => {
		expect(stylesheet('schemes.css')).toMatch(
			/:root\[data-look\]\s*\{[^}]*--border:\s*var\(--input\)/
		);
		expect(CSS.indexOf("@import './schemes.css'")).toBeLessThan(
			CSS.indexOf(":root[data-style='hardline']")
		);
	});
});
