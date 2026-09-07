/**
 * The file of record for DESIGN.md § Typography's font axis: what each value
 * puts in front of a reader, and that nothing it names is fetched from anywhere
 * but the app itself.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(new URL('./app.css', import.meta.url), 'utf8').replace(
	/\/\*[\s\S]*?\*\//g,
	''
);

const SHELLS = ['web', 'native'] as const;
const SHELL_CSS = new Map(
	SHELLS.map((shell) => [
		shell,
		readFileSync(resolve(process.cwd(), `../../../apps/sloppy/${shell}/src/fonts.css`), 'utf8')
	])
);

function declarations(selector: string): Map<string, string> {
	const start = CSS.indexOf(selector);
	if (start < 0) throw new Error(`no ${selector} block in app.css`);
	const body = CSS.slice(CSS.indexOf('{', start) + 1, CSS.indexOf('}', start));
	const out = new Map<string, string>();
	for (const decl of body.split(';')) {
		const colon = decl.indexOf(':');
		if (colon > 0) out.set(decl.slice(0, colon).trim(), decl.slice(colon + 1).trim());
	}
	return out;
}

const BARE = declarations(':root {');
const AXIS = new Map(
	(['atkinson', 'opendyslexic', 'apple'] as const).map((font) => [
		font,
		declarations(`:root[data-app-font='${font}']`)
	])
);

/** The family a stack asks for first, where that is one somebody has to ship —
 *  everything behind it is the system's to answer. */
function shipped(stack: string): string[] {
	const first = /^'([^']+)'/.exec(stack.split(',')[0].trim());
	return first ? [first[1]] : [];
}

describe('the font axis', () => {
	it('gives every value both faces, and a stack that ends somewhere', () => {
		for (const [font, tokens] of AXIS) {
			for (const face of ['--font-sans', '--font-address']) {
				const stack = tokens.get(face);
				expect(stack, `${font} leaves ${face} alone`).toBeDefined();
				expect(stack).not.toBe(BARE.get(face));
				expect(stack).toMatch(/(sans-serif|monospace|serif)$/);
			}
		}
	});

	// DESIGN.md § Typography: legibility outranks alignment, so a family that
	// cannot hold its figures to one width takes the address anyway.
	it('drops the figure guarantee only where the family cannot keep it', () => {
		for (const font of ['atkinson', 'opendyslexic'] as const) {
			expect(AXIS.get(font)?.get('--font-address-figures')).toBe('normal');
			expect(AXIS.get(font)?.get('--font-address-features')).toBe('normal');
		}
		expect(AXIS.get('apple')?.has('--font-address-figures')).toBe(false);

		const address = /@utility address\s*\{([^{}]*)\}/.exec(CSS)?.[1] ?? '';
		expect(address).toContain('var(--font-address-figures, tabular-nums)');
		expect(address).toContain("var(--font-address-features, 'tnum' 1)");
	});

	it('is named by a family both shells hold themselves, or by nobody', () => {
		const families = new Set(
			[BARE, ...AXIS.values()].flatMap((tokens) => [
				...shipped(tokens.get('--font-sans') ?? ''),
				...shipped(tokens.get('--font-address') ?? '')
			])
		);
		expect(families.size).toBeGreaterThan(0);

		for (const [shell, css] of SHELL_CSS) {
			for (const family of families) {
				expect(css, `the ${shell} shell does not hold ${family}`).toContain(
					`font-family: '${family}'`
				);
			}
			expect(css).not.toMatch(/url\(\s*['"]?(https?:)?\/\//);
		}
	});
});
