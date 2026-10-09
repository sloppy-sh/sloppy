/**
 * The file of record for DESIGN.md § Typography's three roles: that the app, a
 * heading and anything drawn to one width each read a token of their own, that
 * nothing in the stylesheet names a family behind a role's back, and that every
 * family named here is one the app holds itself.
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

/** The declarations of the first block whose selector matches. */
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

/** A token's value with every `var()` the root declares spelled out, so a role
 *  is read to the end of the stack it falls back to. */
function spelledOut(token: string, seen: string[] = []): string {
	const value = BARE.get(token);
	if (value === undefined || seen.includes(token)) throw new Error(`:root leaves ${token} unsaid`);
	return value.replace(/var\((--[a-z0-9-]+)\)/g, (_, named: string) =>
		spelledOut(named, [...seen, token])
	);
}

/** Every `font-family` the stylesheet declares, by the selector it is under. */
function faces(): [string, string][] {
	const out: [string, string][] = [];
	for (const [, selector, value] of CSS.matchAll(/([^{}]+)\{[^{}]*?font-family:\s*([^;}]+)[;}]/g)) {
		out.push([selector.trim().replace(/\s+/g, ' '), value.trim()]);
	}
	return out;
}

/** The family a stack asks for first, where that is one somebody has to ship —
 *  everything behind it is the device's to answer. */
function shipped(stack: string): string[] {
	const first = /^'([^']+)'/.exec(stack.split(',')[0].trim());
	return first ? [first[1]] : [];
}

const ROLES = ['--font-sans', '--font-heading', '--font-mono'] as const;

describe('the three faces', () => {
	it('gives each role a token of its own, and a stack that ends somewhere', () => {
		for (const role of ROLES) {
			const stack = spelledOut(role);
			expect(stack, `:root leaves ${role} without a family`).toMatch(/^['\-a-zA-Z]/);
			expect(stack, `${role} ends nowhere`).toMatch(/(sans-serif|monospace|serif)$/);
		}
		// Two stacks, three roles: a heading reaches the app's own face through the
		// token rather than standing on a copy of its stack, so a face chosen for
		// the app carries the headings with it — DESIGN.md § Typography.
		expect(BARE.get('--font-heading')).toBe('var(--font-sans)');
		expect(spelledOut('--font-mono')).not.toBe(spelledOut('--font-sans'));
	});

	// An address is scanned character by character, so it reads in the face code
	// does rather than in a fourth nobody chose.
	it('reads an address in the face code is read in', () => {
		expect(BARE.get('--font-address')).toBe('var(--font-mono)');
		const address = /@utility address\s*\{([^{}]*)\}/.exec(CSS)?.[1] ?? '';
		expect(address).toContain('font-family: var(--font-address)');
		expect(address).toContain('var(--font-address-figures, tabular-nums)');
		expect(address).toContain("var(--font-address-features, 'tnum' 1)");
	});

	// A face is a token the prefs store writes, so there is no attribute left to
	// key a block off — and no block to miss a role.
	it('carries no face axis on the root', () => {
		expect(CSS).not.toContain('data-app-font');
	});

	it('sets every heading in the heading face', () => {
		const headings = faces().filter(([selector]) => /(^|[\s,>])h[1-6]([\s,{]|$)/.test(selector));
		expect(headings.length).toBeGreaterThan(0);
		for (const [selector, value] of headings) {
			expect(value, `${selector} is set in something else`).toBe('var(--font-heading)');
		}
		const levels = headings.flatMap(([selector]) => [...selector.matchAll(/h[1-6]/g)].flat());
		expect([...new Set(levels)].sort()).toEqual(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
	});

	it('sets everything drawn to one width in the face for it', () => {
		const mono = faces().filter(([selector]) =>
			/(^|[\s,])(code|kbd|samp|pre)([\s,{]|$)/.test(selector)
		);
		expect(mono.length).toBeGreaterThan(0);
		for (const [selector, value] of mono) {
			expect(value, `${selector} is set in something else`).toBe('var(--font-mono)');
		}
	});

	// Every rule reaches a face through the role it belongs to: a family written
	// anywhere else is a face nobody can choose.
	it('names a family nowhere but where the roles are declared', () => {
		const roles = [...ROLES, '--font-address'].map((role) => `var(${role})`);
		for (const [selector, value] of faces()) {
			expect(roles, `${selector} names a family of its own`).toContain(value);
		}
	});

	it('is named by a family both shells hold themselves, or by nobody', () => {
		const families = new Set(ROLES.flatMap((role) => shipped(spelledOut(role))));
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
