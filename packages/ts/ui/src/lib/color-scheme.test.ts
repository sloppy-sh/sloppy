/**
 * DESIGN.md § Theme: a person picks a theme independently of the OS, so what
 * the platform draws for us — the on-screen keyboard, form controls, scrollbars,
 * the rubber-band ground — has to be told which way the chosen ground runs.
 *
 * Read out of `app.css` itself, so the declaration is checked against the theme's
 * real ground rather than against a table beside it.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseOklch } from './internal/color.js';

const CSS = readFileSync(new URL('./app.css', import.meta.url), 'utf8').replace(
	/\/\*[\s\S]*?\*\//g,
	''
);

const THEMES = ['paper', 'graphite', 'light', 'dark', 'contrast'] as const;

/** The theme's own block: the one that gives it a ground. */
function groundBlock(theme: string): string {
	const block = /([^{}]+)\{([^{}]*)\}/g;
	let match: RegExpExecArray | null;
	while ((match = block.exec(CSS)) !== null) {
		const claims = match[1].split(',').some((s) => s.trim().endsWith(`[data-theme='${theme}']`));
		if (claims && match[2].includes('--background:')) return match[2];
	}
	throw new Error(`no ground declared for ${theme}`);
}

describe('the ground each theme tells the platform to draw on', () => {
	for (const theme of THEMES) {
		it(`${theme} declares the scheme its own ground runs`, () => {
			const declarations = groundBlock(theme);
			const scheme = /color-scheme:\s*([a-z]+)\s*;/.exec(declarations)?.[1];
			const ground = parseOklch(/--background:\s*([^;]+);/.exec(declarations)?.[1] ?? '');

			expect(ground).not.toBeNull();
			expect(scheme).toBe((ground?.l ?? 1) < 0.5 ? 'dark' : 'light');
		});
	}
});
