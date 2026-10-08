// @vitest-environment jsdom
/**
 * The file of record for the three styles beside Hardline — DESIGN.md
 * § "Style presets". They are read as text, the way density.test.ts reads
 * app.css: what a style may not do is a property of the stylesheet, and a
 * rendered tree cannot be asked whether a colour was named.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { contrastRatio, mixOklab, type Oklch, parseCssColor } from '@sloppy/graph';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Primitives from './components/primitives-harness.test.svelte';
import { stubMediaQuery, stubResizeObserver } from './components/dom.test-support.js';

const STYLES = ['bevel', 'terminal', 'pixel'] as const;
/** The themes app.css paints — the grounds every style is read on. */
const THEMES = ['paper', 'graphite', 'light', 'dark', 'contrast'] as const;
/** What text owes on the surface it is drawn on — WCAG 1.4.3, the floor
 *  token-contrast.test.ts holds the muted ramp to on the page. */
const AA_FLOOR = 4.5;

/* `import.meta.url` is an http URL under the jsdom environment the mounting
   half of this file needs, so the sheets are found by the test's own path. */
const HERE = dirname(expect.getState().testPath ?? '');

function stylesheet(name: string): string {
	return readFileSync(join(HERE, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

const CSS = stylesheet('styles.css');
const APP = stylesheet('app.css');

type Rule = { selector: string; body: string };

/** Innermost blocks only, which is what makes `@layer` and `@media` fall out
 *  for free: a body containing a brace cannot match. */
function rules(css: string): Rule[] {
	return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
		selector: match[1].trim(),
		body: match[2]
	}));
}

const RULES = rules(CSS);
const APP_RULES = rules(APP);

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

/** The one rule in a style's block that declares `property`. */
function declaring(style: string, property: string): Rule {
	const found = block(style).filter((rule) => declares(rule, property));
	expect(found, `${style} declares ${property} in ${found.length} rules`).toHaveLength(1);
	return found[0];
}

/** Every `name(…)` in the sheet, balanced parens and all. */
function calls(css: string, name: string): string[] {
	const out: string[] = [];
	const head = `${name}(`;
	for (let at = css.indexOf(head); at >= 0; at = css.indexOf(head, at + 1)) {
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

/** One of a theme's own two ends, read out of app.css. */
function endOf(theme: string, token: string): Oklch {
	const rule = APP_RULES.find(
		(one) => one.selector.includes(`[data-theme='${theme}']`) && declares(one, token)
	);
	const parsed = rule ? parseCssColor(valueOf(rule, token)) : null;
	if (parsed === null) throw new Error(`app.css gives ${theme} no ${token}`);
	return parsed;
}

const MIX = /^color-mix\(in oklab,\s*var\((--[\w-]+)\)\s*([\d.]+)%,\s*var\((--[\w-]+)\)\)$/;

/** A `color-mix(in oklab, …)` of two tokens, resolved on one theme. */
function mixedOn(theme: string, value: string): Oklch {
	const parts = MIX.exec(value.trim());
	if (parts === null) throw new Error(`this test cannot resolve \`${value}\``);
	return mixOklab(endOf(theme, parts[1]), endOf(theme, parts[3]), 1 - Number(parts[2]) / 100);
}

const RELATIVE =
	/^oklch\(from var\((--[\w-]+)\)\s+(min|max)\(([\d.]+),\s*l\s*([+-])\s*([\d.]+)\)\s+c\s+h\)$/;

/** The lightness a relative `oklch(from var(--x) …)` lands at on one theme —
 *  the bounded `l ± n` form, which is the only one this sheet writes. */
function lightnessOn(theme: string, value: string): number {
	const parts = RELATIVE.exec(value.trim());
	if (parts === null) throw new Error(`this test cannot resolve \`${value}\``);
	const moved = endOf(theme, parts[1]).l + (parts[4] === '+' ? 1 : -1) * Number(parts[5]);
	const bound = Number(parts[3]);
	return parts[2] === 'min' ? Math.min(bound, moved) : Math.max(bound, moved);
}

/** The `:not(:where(…))` group a selector guards itself with, tokens only. */
function guardOf(selector: string): string {
	const found = /:not\(\s*:where\(([^)]*)\)\s*\)/.exec(selector);
	expect(found, `${selector} guards nothing`).not.toBeNull();
	return (found?.[1] ?? '')
		.split(',')
		.map((one) => one.trim())
		.filter(Boolean)
		.sort()
		.join(' ');
}

const SKIP = new Set(['node_modules', 'dist', '.svelte-kit', 'build', 'target', '.git']);

/** Every `.svelte` file the product is drawn from, found from this file rather
 *  than from whichever directory a runner started in. */
function surfaces(): string[] {
	let root = HERE;
	while (!existsSync(join(root, 'pnpm-workspace.yaml'))) {
		const up = dirname(root);
		if (up === root) throw new Error('no workspace root above this test');
		root = up;
	}
	const found: string[] = [];
	const walk = (at: string): void => {
		for (const entry of readdirSync(at, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				if (!SKIP.has(entry.name)) walk(join(at, entry.name));
			} else if (entry.name.endsWith('.svelte')) found.push(join(at, entry.name));
		}
	};
	for (const where of ['packages', 'apps']) walk(join(root, where));
	return found;
}

/** Every class token in those files that puts a box-shadow on a box — the
 *  variant-prefixed forms included, because the prefix is part of the class
 *  name a stylesheet has to match. */
function shadowUtilities(): string[] {
	const found = new Set<string>();
	for (const file of surfaces()) {
		const tokens = readFileSync(file, 'utf8').matchAll(
			/[\w:[\]=.&>*-]*\bshadow-(?:2xs|xs|sm|md|lg|xl|2xl)\b/g
		);
		for (const [token] of tokens) found.add(token);
	}
	return [...found].sort();
}

describe('how a surface is drawn', () => {
	it.each(STYLES)('gives %s a block of its own', (style) => {
		expect(block(style).length).toBeGreaterThan(0);
	});

	// The first of DESIGN.md's five: the dark families declare --border at 0,3,0,
	// so the plain `:root[data-style]` form at 0,2,0 loses to them outright.
	it.each(STYLES)('stands a dark twin beside %s wherever it takes --border', (style) => {
		const taking = block(style).filter((rule) => declares(rule, '--border'));
		expect(taking.length).toBeGreaterThan(0);
		for (const rule of taking) {
			expect(rule.selector).toContain(`.dark:root[data-style='${style}']`);
		}
	});

	// app.css and the editor's own rules read `--radius` inside `calc()`, where a
	// bare `0` is a number rather than a length.
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
		expect(CSS).not.toMatch(/\b(?:rgba?|hsla?|oklab|lch|lab|color)\(/);
		expect(CSS).not.toMatch(/\b(?:black|white|red|green|blue|gray|grey|yellow|orange)\b/);
		// `oklch(from var(--x) …)` is relative colour syntax: a derivation of the
		// token it names, which is the one form of it a style may write.
		for (const call of calls(CSS, 'oklch')) {
			expect(call.trim()).toMatch(/^from var\(--(?:background|foreground)\)/);
		}
	});

	it('mixes its edge from the theme itself, so it composes with every scheme', () => {
		const mixed = calls(CSS, 'color-mix');
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

	// The third of the five: an unlayered rule outranks
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

	// The fifth of the five: an inverted row paints its block under words that
	// were mixed against the page, and the muted ramp is one of those.
	// `::selection` is exempt — it colours the selected range itself, every
	// muted span inside it included.
	it('turns the muted ramp over wherever it inverts a row', () => {
		const inverting = RULES.filter(
			(rule) =>
				valueOf(rule, 'color') === 'var(--background)' && !rule.selector.includes('::selection')
		);
		expect(inverting.length).toBeGreaterThan(0);
		for (const rule of inverting) {
			expect(declares(rule, '--muted-foreground'), rule.selector).toBe(true);
		}
	});

	// The second of the five: `border border-transparent` is also how this
	// product says which chip is selected and which tab is active. The two
	// styles that draw an edge in box-shadow guard one list of shapes, and this
	// is what stops the two copies of it from drifting apart.
	it('leaves every box an author shaped otherwise alone, and both alike', () => {
		const drawing = RULES.filter((rule) => declares(rule, 'box-shadow'));
		expect(drawing.length).toBe(2);
		const groups = new Set(drawing.map((rule) => guardOf(rule.selector)));
		expect(groups.size).toBe(1);
		for (const shape of [
			'.border-transparent',
			'.rounded-full',
			'.border-0',
			'.border-x-0',
			'.border-y-0',
			'.border-t-0',
			'.border-r-0',
			'.border-b-0',
			'.border-l-0'
		]) {
			expect([...groups][0]).toContain(shape);
		}
	});

	// Every size in Tailwind's scale, every variant-prefixed form of one, and
	// every file the product is drawn from: a style that misses one ships a soft
	// blurred shadow in the middle of a hard-edged page.
	it('reaches every shadow utility the product uses', () => {
		const utilities = shadowUtilities();
		expect(utilities.length, 'no shadow utility found at all').toBeGreaterThan(0);
		for (const style of STYLES) {
			const reached = block(style)
				.filter((rule) => declares(rule, '--tw-shadow') || declares(rule, 'box-shadow'))
				.map((rule) => rule.selector.replaceAll('\\', ''))
				.join('\n');
			for (const utility of utilities) {
				expect(reached, `${style} leaves ${utility} as Tailwind drew it`).toContain(`.${utility}`);
			}
		}
	});

	// Each of the three takes off the ring shadcn ships as its focus indicator,
	// so each owes one of its own in its place.
	it.each(STYLES)('draws %s a focus indicator of its own', (style) => {
		const indicators = block(style).filter(
			(rule) => rule.selector.includes(':focus-visible') && declares(rule, 'outline')
		);
		expect(indicators.length).toBeGreaterThan(0);
		for (const rule of indicators) {
			const outline = valueOf(rule, 'outline');
			expect(outline).toMatch(/^[1-9]\d*px /);
			expect(outline).toContain('var(--ring)');
		}
	});

	it('takes no outline away anywhere', () => {
		expect(CSS).not.toMatch(/outline\s*:\s*(?:none|0)\b/);
	});

	// The fourth of the five: none of the three widens an edge, so the condition
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

// DESIGN.md § "Style presets": the light is top-left on every theme, which is
// what makes a raised box read as raised on a dark theme too.
describe('the light Bevel draws by', () => {
	// A light theme's page is already near the top of the lightness scale and a
	// dark one's near the bottom, so the pair is read on one of each.
	it.each(['paper', 'dark'])('stands the near tone above %s and the far below it', (theme) => {
		const tones = declaring('bevel', '--bevel-near');
		const page = endOf(theme, '--background').l;
		expect(lightnessOn(theme, valueOf(tones, '--bevel-near'))).toBeGreaterThan(page);
		expect(lightnessOn(theme, valueOf(tones, '--bevel-far'))).toBeLessThan(page);
	});

	it('puts the near tone on the top and left edges, and the far on the other two', () => {
		const raised = valueOf(declaring('bevel', '--bevel-up'), '--bevel-up');
		expect(raised).toMatch(/^inset 2px 2px \S+ \S+ var\(--bevel-near\)/);
		expect(raised).toContain('inset -2px -2px 0 0 var(--bevel-far)');
	});

	it('swaps the two under a control held down, pressed or standing on', () => {
		const pressed = valueOf(declaring('bevel', '--bevel-down'), '--bevel-down');
		expect(pressed).toMatch(/^inset 2px 2px \S+ \S+ var\(--bevel-far\)/);
		expect(pressed).toContain('inset -2px -2px 0 0 var(--bevel-near)');

		const drawn = block('bevel').filter((rule) => valueOf(rule, '--bevel') !== '');
		expect(drawn.map((rule) => valueOf(rule, '--bevel'))).toEqual([
			'var(--bevel-up)',
			'var(--bevel-down)'
		]);
		for (const held of [':active', "[aria-pressed='true']", "[data-state='checked']"]) {
			expect(drawn[1].selector).toContain(held);
		}
	});
});

describe('the block Terminal inverts a row with', () => {
	it('reaches the row a menu highlights and the row a listbox selects', () => {
		const row = declaring('terminal', '--muted-foreground');
		expect(row.selector).toContain('[data-highlighted]');
		expect(row.selector).toContain("[aria-selected='true']");
		expect(valueOf(row, 'color')).toBe('var(--background)');
	});

	// DESIGN.md § "Contrast is measured, not assumed": the words on the block are
	// measured against the block, and the first of these is why the ramp is
	// re-mixed at all rather than left as the page mixed it.
	it.each(THEMES)('keeps the secondary ink on that row legible on %s', (theme) => {
		const ground = mixedOn(
			theme,
			valueOf(declaring('terminal', '--terminal-block'), '--terminal-block')
		);
		expect(contrastRatio(endOf(theme, '--muted-foreground'), ground)).toBeLessThan(AA_FLOOR);

		const dim = mixedOn(
			theme,
			valueOf(declaring('terminal', '--muted-foreground'), '--muted-foreground')
		);
		expect(contrastRatio(dim, ground)).toBeGreaterThanOrEqual(AA_FLOOR);
		expect(contrastRatio(endOf(theme, '--background'), ground)).toBeGreaterThanOrEqual(AA_FLOOR);
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
