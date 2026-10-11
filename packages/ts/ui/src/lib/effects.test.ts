// DESIGN.md § "The effect axis" is the doc of record: an effect is a texture
// nothing can land on, it names no colour of its own, it stands beside every
// other screen rather than over it, and its motion goes where the reader has
// asked for less of it. Every screen is held to all of it, so a new one cannot
// ship with half.

import { TEXTURES } from '@sloppy/types';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SHEET = readFileSync(new URL('./effects.css', import.meta.url), 'utf8');
const CSS = SHEET.replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the block at `selector`, from `after`, skipping
 *  `past` earlier blocks that the same selector stands in. */
function declarations(after: string, selector: string, past = 0): Map<string, string> {
	const from = after === '' ? 0 : CSS.indexOf(after);
	expect(from).toBeGreaterThanOrEqual(0);
	let start = CSS.indexOf(selector, from);
	for (let again = 0; again < past && start >= 0; again += 1)
		start = CSS.indexOf(selector, start + 1);
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

/** Everything one screen declares, over however many blocks it takes. */
function rulesFor(effect: string): string {
	return [...CSS.matchAll(new RegExp(`:root\\[data-effect~='${effect}'\\][^{]*\\{([^}]*)\\}`, 'g'))]
		.map((found) => found[1])
		.join(' ');
}

/** A comma-separated value as its entries — the commas inside a `var()` or a
 *  gradient belong to that entry. */
function entries(value: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let from = 0;
	[...value].forEach((letter, at) => {
		if (letter === '(') depth += 1;
		else if (letter === ')') depth -= 1;
		else if (letter === ',' && depth === 0) {
			out.push(value.slice(from, at));
			from = at + 1;
		}
	});
	out.push(value.slice(from));
	return out.map((one) => one.trim()).filter((one) => one !== '');
}

/** The one block every screen is drawn in. */
const OVERLAY = ':root[data-effect] body::after';
/** The layers that block draws: one slot for every painted screen to fill. */
const SLOTS = entries(/background-position:([^;]*);/.exec(CSS)?.[1] ?? '').length;
/** The highest the app's own chrome stacks: a dock filling the page,
 *  `side-dock.svelte` (`60 + stack`, the chat dock at stack 1). */
const CHROME_CEILING = 61;

describe('the screen a page is drawn on', () => {
	it('is plain where nothing says otherwise, and says it in one place', () => {
		expect(CSS).toContain(OVERLAY);
		// Absent IS plain: nothing keys off a value of its own for it.
		expect(CSS).not.toContain("data-effect~='plain'");
		expect(CSS).not.toContain("data-effect~='none'");
	});

	it('lays every screen over everything and lets every tap through it', () => {
		const overlay = declarations('', OVERLAY);
		expect(overlay.get('pointer-events')).toBe('none');
		expect(overlay.get('position')).toBe('fixed');
		expect(Number(overlay.get('z-index'))).toBeGreaterThan(CHROME_CEILING);
	});

	it.each(TEXTURES)('shows %s as itself, from the rules the page wears', (effect) => {
		// The sample is not a second copy: every block that dresses the page in a
		// screen dresses a sample in it too, in the same selector list.
		for (const block of CSS.matchAll(
			new RegExp(`([^}]*):root\\[data-effect~='${effect}'\\]([^{]*)\\{`, 'g')
		)) {
			const selectors = `${block[1].split('}').at(-1) ?? ''}:root[data-effect~='${effect}']${block[2]}`;
			expect(selectors).toContain(`[data-screen='${effect}']`);
		}
		expect(CSS).toContain(`[data-screen='${effect}']`);
	});

	it('lets a sample carry its screen without laying it over anything else', () => {
		const sample = declarations('', '[data-screen]::after');
		expect(sample.get('position')).toBe('absolute');
		expect(sample.get('pointer-events')).toBe('none');
		expect(declarations('', '[data-screen] {').get('overflow')).toBe('hidden');
	});

	it.each(TEXTURES)('draws %s as a texture of its own', (effect) => {
		const rules = rulesFor(effect);
		expect(rules.trim()).not.toBe('');
		// A texture, not a shape: what each screen says is how the page is
		// covered, never where anything sits.
		for (const laying of ['position', 'inset', 'width', 'height', 'margin', 'padding']) {
			expect(rules).not.toMatch(new RegExp(`(^|[;\\s])${laying}\\s*:`));
		}
	});

	// DESIGN.md § "The effect axis": an effect mixes from the theme's ink, so it
	// composes with every look.
	it('names no colour of its own', () => {
		expect(CSS).not.toMatch(/#[0-9a-f]{3,8}\b/i);
		expect(CSS).not.toMatch(/\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\(/);
		expect(CSS).not.toMatch(
			/\b(?:white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|silver|navy|teal|olive|maroon|aqua|fuchsia|lime)\b/
		);
		for (const effect of TEXTURES) expect(rulesFor(effect)).toContain('var(--foreground)');
	});

	it('stops moving where the reader has asked for less motion', () => {
		const still = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
		expect(still).not.toBe('');
		for (const effect of TEXTURES) {
			if (!/animation:/.test(rulesFor(effect))) continue;
			expect(still).toContain(`data-effect~='${effect}'`);
			expect(still).toMatch(/animation:\s*none/);
		}
	});
});

// DESIGN.md § "The effect axis": several screens are drawn at once, so each one
// has somewhere of its own to be drawn and none of them is in another's way.
describe('several screens at once', () => {
	/** The properties a run of declarations writes. */
	function written(rules: string): string[] {
		return rules
			.split(';')
			.map((one) => one.slice(0, one.indexOf(':')).trim())
			.filter((one) => one !== '' && !one.includes('{'));
	}

	it('lets every screen be on at once, because no two write the same thing', () => {
		const writer = new Map<string, string>();
		for (const effect of TEXTURES) {
			// A screen says the same thing in as many blocks as it takes — the
			// still twin of a moving one says `animation` again — and only two
			// screens saying it is two screens in each other's way.
			const mine = new Set(written(rulesFor(effect)));
			expect(mine.size).toBeGreaterThan(0);
			for (const property of mine) {
				expect(writer.get(property), `${writer.get(property)} writes ${property} too`).toBe(
					undefined
				);
				writer.set(property, effect);
			}
		}
	});

	it('draws every slot a screen fills', () => {
		const drawn = new Set([...CSS.matchAll(/var\((--screen-[a-z-]+)/g)].map((one) => one[1]));
		for (const effect of TEXTURES)
			for (const property of written(rulesFor(effect)))
				if (property.startsWith('--screen-')) expect([...drawn]).toContain(property);
	});

	it('keeps a size, a place and a repeat beside every layer it draws', () => {
		const shared = declarations('', OVERLAY, 1);
		// A slot draws however many layers it falls back to, so a screen that
		// takes two of them takes two of everything beside them.
		const layers = entries(shared.get('background-image') ?? '')
			.map((slot) => entries(/^var\(\s*--[a-z-]+\s*,([\s\S]*)\)$/.exec(slot)?.[1] ?? slot).length)
			.reduce((all, one) => all + one, 0);
		expect(layers).toBe(SLOTS);
		for (const beside of ['background-size', 'background-position', 'background-repeat'])
			expect(entries(shared.get(beside) ?? '').length).toBe(SLOTS);
	});
});

// DESIGN.md § "The effect axis": how much of a screen there is and how big it
// is are the reader's, as two numbers every screen reads the same way.
describe('how much of a screen there is', () => {
	it('stands at rest until somebody moves it', () => {
		const held = declarations('', ':root {');
		// Opaque at rest: the screens reach the whole page until asked otherwise.
		expect(held.get('--screen-mask')).toContain('var(--foreground)');
		expect(held.get('--screen-mask')).not.toContain('transparent');
	});

	it.each(TEXTURES)('draws %s at the strength and the size IT is asked for', (effect) => {
		const rules = rulesFor(effect);
		// Its own two numbers, falling back to the one thing it is at rest: a
		// screen somebody turned up says nothing about the screen beside it.
		expect(rules).toContain(`var(--screen-${effect}-strength, 1)`);
		expect(rules).toContain(`var(--screen-${effect}-scale, 1)`);
		for (const other of TEXTURES)
			if (other !== effect) expect(rules).not.toContain(`var(--screen-${other}-`);
	});

	it('gives the middle up where somebody asks for the edges alone', () => {
		const edges = declarations('', ":root[data-screen-reach='edges']");
		expect(edges.get('--screen-mask')).toContain('transparent');
		for (const block of [OVERLAY, '[data-screen]::after'])
			expect(declarations('', block).get('mask-image')).toBe('var(--screen-mask)');
	});

	it('shows a sample whole, whatever the page is giving up', () => {
		const sample = declarations('', '[data-screen] {');
		expect(sample.get('--screen-mask')).toContain('var(--foreground)');
		expect(sample.get('--screen-mask')).not.toContain('transparent');
	});

	it('sweeps one band down the tube and leaves the rest of it still', () => {
		expect(rulesFor('crt')).toContain('sloppy-crt-sweep');
		const sweep = /@keyframes sloppy-crt-sweep\s*\{([\s\S]*?\n\})/.exec(CSS);
		const ends = sweep?.[1].split('background-position:').slice(1) ?? [];
		expect(ends.length).toBe(2);
		// A position shorter than the layers it is given to is repeated across
		// them, so each end of the sweep names every slot the page is drawn in —
		// otherwise every screen beside the band travels with it.
		expect(SLOTS).toBeGreaterThan(1);
		for (const end of ends) expect(entries(end.split(';')[0]).length).toBe(SLOTS);
	});
});

// DESIGN.md § "The effect axis": held to no floor, bounded instead — these are
// the bounds the doc promises at rest. A reader who wants more of a screen than
// this is what the strength is for, so the bounds are read off the rules rather
// than off what any one person has set.
describe('how much of the ink a screen takes at rest', () => {
	const shares = (text: string): number[] =>
		[...text.matchAll(/var\(--foreground\)\s+(?:calc\(\s*)?(\d+(?:\.\d+)?)%/g)].map((one) =>
			Number(one[1])
		);

	it('never more than a fifth over the page, and never a third of the ink', () => {
		const everywhere = shares(SHEET);
		expect(everywhere.length).toBeGreaterThan(0);

		for (const over of SHEET.matchAll(/body::after[^{]*\{([^}]*)\}/g))
			for (const share of shares(over[1])) expect(share).toBeLessThanOrEqual(20);

		for (const ink of SHEET.matchAll(/text-shadow:([^;]*)/g))
			for (const share of shares(ink[1])) expect(share).toBeLessThanOrEqual(30);
	});
});
