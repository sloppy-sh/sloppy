// @vitest-environment jsdom
import { type GraphHiddenLines, type GraphLines, UNLABELLED_LINE } from '@sloppy/graph';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import LineSwitches from './line-switches.svelte';
import { NOTHING_HIDDEN } from './lines.js';

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let changes: GraphHiddenLines[];
let bundled: { on: boolean; strength: number }[];
let spreads: number[];

const lines: GraphLines = {
	kinds: { link: 361, run: 40, reference: 0, genealogy: 228 },
	labels: new Map([
		['uses', 180],
		['used by', 120],
		[UNLABELLED_LINE, 61]
	])
};

function show(
	hidden: GraphHiddenLines = NOTHING_HIDDEN,
	counted: GraphLines = lines,
	bundle = { on: false, strength: 0.85 },
	spread = 1
) {
	changes = [];
	bundled = [];
	spreads = [];
	mounted = mount(LineSwitches, {
		target,
		props: {
			lines: counted,
			hidden,
			onchange: (next: GraphHiddenLines) => changes.push(next),
			bundle,
			onbundle: (next) => bundled.push(next),
			spread,
			onspread: (next) => spreads.push(next)
		}
	});
	flushSync();
}

const rows = () =>
	[...target.querySelectorAll<HTMLLabelElement>('label')].map((row) =>
		row.textContent?.replace(/\s+/g, ' ').trim()
	);
const switchFor = (words: string) =>
	[...target.querySelectorAll<HTMLLabelElement>('label')]
		.find((row) => row.textContent?.includes(words))
		?.querySelector<HTMLButtonElement>('[role="switch"]');
const slider = (named: string) =>
	target.querySelector<HTMLElement>(`[role="slider"][aria-label="${named}"]`);
const button = (words: string) =>
	[...target.querySelectorAll<HTMLButtonElement>('button')].find(
		(one) => one.textContent?.trim() === words
	);

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
});

describe('the lines a reader can turn off', () => {
	it('lists each kind the canvas draws, and each relation under hand links, with counts', () => {
		show();
		expect(rows()).toEqual([
			'Drawn by hand 361',
			'uses 180',
			'used by 120',
			'No label 61',
			'Carries on 40',
			'Sprang from 228',
			'Bundle'
		]);
	});

	it('turns a kind off, and a relation off, without touching the rest', () => {
		show();
		switchFor('Sprang from')?.click();
		flushSync();
		expect([...changes[0].kinds]).toEqual(['genealogy']);
		expect(changes[0].labels.size).toBe(0);

		switchFor('used by')?.click();
		flushSync();
		expect([...changes[1].labels]).toEqual(['used by']);
		expect(changes[1].kinds.size).toBe(0);
	});

	it('keeps the row of a kind turned off, so it can be turned back on', () => {
		const counted = { ...lines, kinds: { ...lines.kinds, reference: 0 } };
		show({ kinds: new Set(['reference']), labels: new Set() }, counted);
		expect(rows()).toContain('Mentions 0');
		switchFor('Mentions')?.click();
		flushSync();
		expect(changes[0].kinds.size).toBe(0);
	});

	it('turns every relation off at once, and on again', () => {
		show();
		button('Hide all')?.click();
		flushSync();
		expect(new Set(changes[0].labels)).toEqual(new Set(['uses', 'used by', UNLABELLED_LINE]));
		expect(button('Show all')?.disabled).toBe(true);

		if (mounted) unmount(mounted, { outro: false });
		show(changes[0]);
		button('Show all')?.click();
		flushSync();
		expect(changes[0].labels.size).toBe(0);
	});

	it('says so where there are no lines at all', () => {
		show(NOTHING_HIDDEN, {
			kinds: { link: 0, run: 0, reference: 0, genealogy: 0 },
			labels: new Map()
		});
		expect(target.textContent).toContain('No lines on the canvas.');
	});
});

describe('bundling the lines drawn by hand', () => {
	it('is the last row, off with nothing to set until it is turned on', () => {
		show();
		expect(rows().at(-1)).toBe('Bundle');
		expect(switchFor('Bundle')?.getAttribute('aria-checked')).toBe('false');
		expect(slider('How tightly')).toBeNull();
	});

	it('hands back the turn, keeping how tight it was', () => {
		show(NOTHING_HIDDEN, lines, { on: false, strength: 0.4 });
		switchFor('Bundle')?.click();
		flushSync();
		expect(bundled).toEqual([{ on: true, strength: 0.4 }]);
	});

	it('offers how tightly once it is on', () => {
		show(NOTHING_HIDDEN, lines, { on: true, strength: 0.85 });
		expect(slider('How tightly')?.getAttribute('aria-valuenow')).toBe('0.85');
	});

	it('cannot be turned while the lines drawn by hand are off', () => {
		show({ kinds: new Set(['link']), labels: new Set() });
		expect(switchFor('Bundle')?.disabled).toBe(true);
	});

	it('is not offered where no line was drawn by hand', () => {
		show(NOTHING_HIDDEN, { ...lines, kinds: { ...lines.kinds, link: 0 }, labels: new Map() });
		expect(rows()).not.toContain('Bundle');
	});
});

describe('room between marks', () => {
	it('stands at the foot of the lines, at the room it was given', () => {
		show(NOTHING_HIDDEN, lines, { on: true, strength: 0.85 }, 1.5);
		const sliders = [...target.querySelectorAll('[role="slider"]')];
		expect(sliders.at(-1)).toBe(slider('Room between marks'));
		expect(slider('Room between marks')?.getAttribute('aria-valuenow')).toBe('1.5');
		expect(slider('Room between marks')?.getAttribute('aria-valuemin')).toBe('1');
		expect(slider('Room between marks')?.getAttribute('aria-valuemax')).toBe('2.5');
	});

	it('hands back more room when it is asked for', () => {
		show();
		const thumb = slider('Room between marks');
		thumb?.focus();
		thumb?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		flushSync();
		expect(spreads).toEqual([1.05]);
	});

	it('is offered on a canvas with no lines on it', () => {
		show(NOTHING_HIDDEN, {
			kinds: { link: 0, run: 0, reference: 0, genealogy: 0 },
			labels: new Map()
		});
		expect(slider('Room between marks')).not.toBeNull();
	});
});
