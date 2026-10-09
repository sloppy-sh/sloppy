/**
 * DESIGN.md § "The look": a person picks a look independently of the OS, so what
 * the platform draws for us — the keyboard, form controls, scrollbars, the
 * rubber-band ground — has to be told which way the chosen ground runs.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseOklch } from './internal/color.js';

const CSS = readFileSync(new URL('./app.css', import.meta.url), 'utf8').replace(
	/\/\*[\s\S]*?\*\//g,
	''
);

const LOOKS = ['paper', 'graphite', 'light', 'dark', 'contrast'] as const;

/** The look's own block: the one that gives it a ground. */
function groundBlock(look: string): string {
	const block = /([^{}]+)\{([^{}]*)\}/g;
	let match: RegExpExecArray | null;
	while ((match = block.exec(CSS)) !== null) {
		const claims = match[1].split(',').some((s) => s.trim().endsWith(`[data-look='${look}']`));
		if (claims && match[2].includes('--background:')) return match[2];
	}
	throw new Error(`no ground declared for ${look}`);
}

describe('the ground each look tells the platform to draw on', () => {
	for (const look of LOOKS) {
		it(`${look} declares the scheme its own ground runs`, () => {
			const declarations = groundBlock(look);
			const scheme = /color-scheme:\s*([a-z]+)\s*;/.exec(declarations)?.[1];
			const ground = parseOklch(/--background:\s*([^;]+);/.exec(declarations)?.[1] ?? '');

			expect(ground).not.toBeNull();
			expect(scheme).toBe((ground?.l ?? 1) < 0.5 ? 'dark' : 'light');
		});
	}
});
