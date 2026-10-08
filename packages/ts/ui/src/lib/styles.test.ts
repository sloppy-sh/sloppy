// @vitest-environment jsdom
/**
 * The file of record for the three styles beside Hardline — DESIGN.md
 * § "Style presets". They are read as text, the way density.test.ts reads
 * app.css: what a style may not do is a property of the stylesheet, and a
 * rendered tree cannot be asked whether a colour was named.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Primitives from './components/primitives-harness.test.svelte';
import { stubMediaQuery, stubResizeObserver } from './components/dom.test-support.js';

const STYLES = ['bevel', 'terminal', 'pixel'] as const;

/* `import.meta.url` is an http URL under the jsdom environment the mounting
   half of this file needs, so the sheets are found by the test's own path. */
const HERE = dirname(expect.getState().testPath ?? '');

function stylesheet(name: string): string {
	return readFileSync(join(HERE, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

const CSS = stylesheet('styles.css');
const APP = stylesheet('app.css');

type Rule = { selector: string; body: string };

const RULES: Rule[] = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
	selector: match[1].trim(),
	body: match[2]
}));

/** The rules of the one style, from its first selector to the next style's. */
function block(style: string): Rule[] {
	const own = `:root[data-style='${style}']`;
	const others = STYLES.filter((other) => other !== style).map(
		(other) => `:root[data-style='${other}']`
	);
	const from = RULES.findIndex((rule) => rule.selector.includes(own));
	expect(from, `no ${style} block in styles.css`).toBeGreaterThanOrEqual(0);
	const rest = RULES.slice(from + 1);
	const to = rest.findIndex((rule) => others.some((other) => rule.selector.includes(other)));
	return to < 0 ? RULES.slice(from) : RULES.slice(from, from + 1 + to);
}

function declares(rule: Rule, property: string): boolean {
	return new RegExp(`(^|[;\\s])${property}\\s*:`).test(rule.body);
}

function valueOf(rule: Rule, property: string): string {
	const found = new RegExp(`(?:^|[;\\s])${property}\\s*:([^;]*)`).exec(rule.body);
	return found ? found[1].trim() : '';
}

/** Every `color-mix(…)` in the sheet, balanced parens and all. */
function mixes(css: string): string[] {
	const out: string[] = [];
	for (let at = css.indexOf('color-mix('); at >= 0; at = css.indexOf('color-mix(', at + 1)) {
		let depth = 0;
		let end = css.indexOf('(', at);
		for (; end < css.length; end++) {
			if (css[end] === '(') depth++;
			else if (css[end] === ')' && --depth === 0) break;
		}
		out.push(css.slice(css.indexOf('(', at) + 1, end));
	}
	return out;
}

describe('how a surface is drawn', () => {
	it.each(STYLES)('gives %s a block of its own', (style) => {
		expect(block(style).length).toBeGreaterThan(0);
	});

	// The first of DESIGN.md's four: the dark families declare --border at 0,3,0,
	// so the plain `:root[data-style]` form at 0,2,0 loses to them outright.
	it.each(STYLES)('stands a dark twin beside %s wherever it takes --border', (style) => {
		const taking = block(style).filter((rule) => declares(rule, '--border'));
		expect(taking.length).toBeGreaterThan(0);
		for (const rule of taking) {
			expect(rule.selector).toContain(`.dark:root[data-style='${style}']`);
		}
	});

	// A bare `0` is a number, not a length: it makes app.css's
	// `calc(var(--radius) - 4px)` invalid and takes every derived radius with it.
	it.each(STYLES)('squares %s with a zero that is a length', (style) => {
		const taking = block(style).filter((rule) => declares(rule, '--radius'));
		expect(taking.length).toBe(1);
		expect(valueOf(taking[0], '--radius')).toBe('0px');
	});

	it('squares the radii app.css does not derive from --radius', () => {
		const squaring = RULES.find((rule) => declares(rule, 'border-radius'));
		expect(squaring?.selector).toContain('.rounded-xl');
		expect(squaring?.selector).not.toContain('.rounded-full');
		for (const style of STYLES) expect(squaring?.selector).toContain(`[data-style='${style}']`);
	});
});

describe('what a style may not do', () => {
	it('names no colour anywhere', () => {
		expect(CSS).not.toMatch(/#[0-9a-fA-F]{3}/);
		expect(CSS).not.toMatch(/\b(?:rgba?|hsla?|oklch|oklab|lch|lab|color)\(/);
		expect(CSS).not.toMatch(/\b(?:black|white|red|green|blue|gray|grey|yellow|orange)\b/);
	});

	it('mixes its edge from the theme itself, so it composes with every scheme', () => {
		const mixed = mixes(CSS);
		expect(mixed.length).toBeGreaterThan(0);
		for (const mix of mixed) {
			const rest = mix
				.replace(/in oklab/g, '')
				.replace(/var\(--foreground\)/g, '')
				.replace(/var\(--background\)/g, '')
				.replace(/[\d.%,\s]/g, '');
			expect(rest, `color-mix(${mix}) reaches past the theme's own two ends`).toBe('');
		}
	});

	// DESIGN.md § "The canvas is exempt from `data-style`". It is never given a
	// utility class, so matching only those is the whole of staying out of it.
	it('never reaches the canvas', () => {
		expect(CSS).not.toMatch(/data-graph/);
		expect(CSS).not.toMatch(/\bcanvas\b/);
		expect(CSS).not.toMatch(/\]\s*\*/);
	});

	// The third of the four: an unlayered rule outranks
	// `focus-visible:border-ring` and `aria-invalid:border-destructive`.
	it('eats neither a focus indicator nor an error state', () => {
		const edges = RULES.filter((rule) => declares(rule, 'border-color'));
		expect(edges.length).toBe(STYLES.length);
		for (const rule of edges) {
			expect(rule.selector).toContain(':not(:focus-visible)');
			expect(rule.selector).toContain(":not([aria-invalid='true'])");
		}
		const rings = RULES.filter((rule) => declares(rule, '--tw-ring-color'));
		expect(rings.length).toBe(STYLES.length);
		for (const rule of rings) {
			expect(rule.selector).toContain(":not([aria-invalid='true'])");
		}
	});

	// The second of the four: `border border-transparent` is also how this
	// product says which chip is selected and which tab is active.
	it('leaves an edge an author left for a state to fill', () => {
		const drawing = RULES.filter((rule) => declares(rule, 'box-shadow'));
		expect(drawing.length).toBeGreaterThan(0);
		for (const rule of drawing) {
			expect(rule.selector).toContain(':not(.border-transparent)');
		}
	});

	// The fourth of the four: none of the three widens an edge, so the condition
	// that spills a thumb out of a track hand-sized around 1px never arises.
	it('leaves every control the geometry it was drawn at', () => {
		expect(CSS).not.toMatch(/border-[a-z-]*width/);
	});

	// Tailwind composes box-shadow out of five variables; a rule that sets the
	// property outright has to carry all five or the ring on the same element
	// goes with it.
	it('keeps a ring on a box whose shadow it writes outright', () => {
		for (const rule of RULES.filter((one) => declares(one, 'box-shadow'))) {
			for (const term of [
				'--tw-inset-shadow',
				'--tw-inset-ring-shadow',
				'--tw-ring-offset-shadow',
				'--tw-ring-shadow',
				'--tw-shadow'
			]) {
				expect(valueOf(rule, 'box-shadow')).toContain(`var(${term}`);
			}
		}
	});

	it('lands after the Hardline block, where --border is still to be won', () => {
		expect(APP.indexOf("@import './styles.css'")).toBeGreaterThan(
			APP.indexOf(":root[data-style='hardline']")
		);
	});
});

describe('every primitive under every style', () => {
	let target: HTMLElement;
	let mounted: ReturnType<typeof mount> | undefined;

	beforeEach(() => {
		stubResizeObserver();
		stubMediaQuery(() => false);
		target = document.createElement('div');
		document.body.appendChild(target);
	});

	afterEach(() => {
		if (mounted) unmount(mounted, { outro: false });
		mounted = undefined;
		target.remove();
		delete document.documentElement.dataset.style;
	});

	it.each(STYLES)('mounts under %s', (style) => {
		document.documentElement.dataset.style = style;
		mounted = mount(Primitives, { target });
		flushSync();
		expect(target.querySelector('button')).not.toBeNull();
		expect(document.documentElement.dataset.style).toBe(style);
	});
});
