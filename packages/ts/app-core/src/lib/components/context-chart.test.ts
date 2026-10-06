// The bar saying how full the assistant's context is.

import type { ContextPart, ContextPartKind, ContextUsage } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HUES as LANE_HUES } from './commit-graph.svelte';
import ContextChart from './context-chart.svelte';
import { barOf, contextSaid, HUES, NOT_LISTED, shareSaid, spans } from './context-chart.js';

/** The bar's own width, which is what it reads — never the window's. */
const ACROSS = 400;

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

function part(name: string, tokens: number, kind: ContextPartKind = 'used'): ContextPart {
	return { name, tokens, kind };
}

function usage(over: Partial<ContextUsage> = {}): ContextUsage {
	return {
		total: 0,
		limit: 1000,
		parts: [],
		at: '2026-10-06T09:00:00.000Z',
		...over
	};
}

function room(wide: number): void {
	Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
		configurable: true,
		get(this: HTMLElement) {
			return this.tagName === 'DIV' ? wide : 0;
		}
	});
}

function draw(usage: ContextUsage | null, over: { open?: boolean } = {}): void {
	mounted = mount(ContextChart, { target, props: { usage, ...over } });
	flushSync();
}

/** Drawn lengths read back as a reader sees them: a difference a screen cannot
 *  paint is a difference this suite has no business asserting. */
function round(said: string | number | null): number {
	return Math.round(Number(said) * 1e4) / 1e4;
}

function bands(): { name: string; x: number; width: number; hue: string }[] {
	return [...target.querySelectorAll('rect[data-band]')].map((one) => ({
		name: one.getAttribute('data-band') ?? '',
		x: round(one.getAttribute('x')),
		width: round(one.getAttribute('width')),
		hue: one.getAttribute('class') ?? ''
	}));
}

function kept(): { name: string; x: number; width: number }[] {
	return [...target.querySelectorAll('rect[data-kept]')].map((one) => ({
		name: one.getAttribute('data-kept') ?? '',
		x: round(one.getAttribute('x')),
		width: round(one.getAttribute('width'))
	}));
}

/** How the bar draws each thing, by the name it carries: ink it has spent, or
 *  the hatch over room it has not. */
function looks(): Record<string, string> {
	const got: Record<string, string> = {};
	for (const one of target.querySelectorAll('rect[data-band], rect[data-kept]')) {
		const name = one.getAttribute('data-band') ?? one.getAttribute('data-kept') ?? '';
		got[name] = one.getAttribute('fill') === 'currentColor' ? 'solid' : 'hatched';
	}
	return got;
}

/** How the list draws each swatch, by the name beside it. */
function listLooks(): Record<string, string> {
	const got: Record<string, string> = {};
	for (const row of target.querySelectorAll('li')) {
		const name = (row.querySelector('span:not([aria-hidden])')?.textContent ?? '').trim();
		got[name] = row.querySelector('span[aria-hidden]') ? 'solid' : 'hatched';
	}
	return got;
}

/** Whether the list's hatched swatches are painted by the bar's own hatch,
 *  rather than by a second one that could drift from it. */
function swatchPaints(): (string | null)[] {
	return [...target.querySelectorAll('li svg rect')].map((one) => one.getAttribute('fill'));
}

/** Anything the chart paints at less than its own strength. A colour composited
 *  onto the page is a colour nothing has measured. */
function washed(): string[] {
	return [...target.querySelectorAll('*')].flatMap((one) => {
		const said =
			one.getAttribute('opacity') ??
			/opacity:\s*([\d.]+)/.exec(one.getAttribute('style') ?? '')?.[1];
		return said !== undefined && said !== null && Number(said) < 1
			? [one.tagName.toLowerCase()]
			: [];
	});
}

function lines(): string[] {
	return [...target.querySelectorAll('p')].map((one) =>
		(one.textContent ?? '').replace(/\s+/g, ' ').trim()
	);
}

function legend(): string[] {
	return [...target.querySelectorAll('li')].map((one) =>
		(one.textContent ?? '').replace(/\s+/g, ' ').trim()
	);
}

function sentence(): string {
	return target.querySelector('svg')?.getAttribute('aria-label') ?? '';
}

beforeEach(() => {
	room(ACROSS);
	Object.defineProperty(globalThis, 'ResizeObserver', {
		configurable: true,
		writable: true,
		value: class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	});
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.body.innerHTML = '';
});

describe('the bar', () => {
	it('draws nothing where the assistant has not said', () => {
		draw(null);
		expect(target.querySelector('svg')).toBeNull();
		expect(lines()).toEqual([]);
	});

	it('gives each band a width proportional to what it holds, against the window', () => {
		draw(
			usage({
				total: 500,
				limit: 1000,
				parts: [part('Instructions', 100), part('Tools', 150), part('Conversation', 250)]
			})
		);
		expect(bands()).toEqual([
			{ name: 'Instructions', x: 0, width: 40, hue: 'text-facet-1' },
			{ name: 'Tools', x: 40, width: 60, hue: 'text-facet-2' },
			{ name: 'Conversation', x: 100, width: 100, hue: 'text-facet-3' }
		]);
	});

	it('borrows the slots the lanes borrow, so neither drifts from the other', () => {
		expect(HUES).toEqual(LANE_HUES);
	});

	it('wraps a ninth band onto the first slot', () => {
		const nine = Array.from({ length: 9 }, (_, at) => part(`Part ${at + 1}`, 10));
		draw(usage({ total: 90, limit: 1000, parts: nine }));
		expect(bands().map((one) => one.hue)).toEqual([...HUES, 'text-facet-1']);
	});

	it('scales against the window rather than against what is in it', () => {
		draw(usage({ total: 200, limit: 4000, parts: [part('Instructions', 200)] }));
		expect(bands()[0].width).toBe(20);
	});

	// DESIGN.md § "The context as a bar": a band at a third of its strength on
	// the page reads under 2:1, and a graphical object owes 3:1.
	it('paints nothing at less than its own strength, in the bar or in the list', () => {
		draw(
			usage({
				total: 400,
				limit: 1000,
				parts: [part('Instructions', 300), part('Room to answer', 100, 'buffer')]
			}),
			{ open: true }
		);
		expect(washed()).toEqual([]);
	});

	it('keeps a band inside the bar where the counts run past the window', () => {
		draw(
			usage({ total: 1500, limit: 1000, parts: [part('Instructions', 900), part('Tools', 600)] })
		);
		const drawn = bands();
		expect(drawn.map((one) => one.width)).toEqual([360, 40]);
		expect(drawn[1].x + drawn[1].width).toBeLessThanOrEqual(ACROSS);
	});
});

describe('what is held aside', () => {
	it('is not a band in the bar and is said in the line under it', () => {
		draw(
			usage({
				total: 300,
				limit: 1000,
				parts: [part('Instructions', 300), part('Tool definitions', 120, 'deferred')]
			})
		);
		expect(bands().map((one) => one.name)).toEqual(['Instructions']);
		expect(lines()[0]).toBe('300 of 1k · 120 held aside');
	});

	it('leaves the line alone where nothing is held aside', () => {
		draw(usage({ total: 300, limit: 1000, parts: [part('Instructions', 300)] }));
		expect(lines()[0]).toBe('300 of 1k');
	});
});

describe('room kept back for the answer', () => {
	it('stands at the far end of the window, under the name the assistant gave it', () => {
		draw(
			usage({
				total: 200,
				limit: 1000,
				parts: [part('Instructions', 200), part('Room to answer', 100, 'buffer')]
			})
		);
		expect(kept()).toEqual([{ name: 'Room to answer', x: 360, width: 40 }]);
	});

	it('gives up what the fill has taken rather than drawing over it', () => {
		draw(
			usage({
				total: 950,
				limit: 1000,
				parts: [part('Conversation', 950), part('Room to answer', 200, 'buffer')]
			})
		);
		const band = bands()[0];
		expect(kept()).toEqual([{ name: 'Room to answer', x: 380, width: 20 }]);
		expect(kept()[0].x).toBeGreaterThanOrEqual(band.x + band.width);
	});

	it('is hatched rather than filled like ink the assistant has spent', () => {
		draw(
			usage({
				total: 400,
				limit: 1000,
				parts: [part('Instructions', 300), part('Room to answer', 100, 'buffer')]
			}),
			{ open: true }
		);
		expect(looks()).toEqual({
			Instructions: 'solid',
			[NOT_LISTED]: 'solid',
			'Room to answer': 'hatched'
		});
	});
});

describe('the compaction mark', () => {
	it('stands where the assistant says it makes room', () => {
		draw(usage({ total: 200, limit: 1000, compactsAt: 800, parts: [part('Instructions', 200)] }));
		const tick = target.querySelector('line[data-compacts-at]');
		expect(round(tick?.getAttribute('x1') ?? null)).toBe(320);
		expect(tick?.querySelector('title')?.textContent).toBe('Compacts here');
	});

	it('is absent where the assistant does not say', () => {
		draw(usage({ total: 200, limit: 1000, parts: [part('Instructions', 200)] }));
		expect(target.querySelector('line')).toBeNull();
	});

	it('says what a turn that made room came down from', () => {
		draw(
			usage({
				total: 200,
				limit: 1000,
				parts: [part('Instructions', 200)],
				compacted: { from: 920 }
			})
		);
		expect(lines()).toEqual(['200 of 1k', 'Compacted from 920']);
	});
});

describe('the fill between one breakdown and the next', () => {
	it('follows what the assistant says is in the window', () => {
		draw(usage({ total: 400, limit: 1000, parts: [part('Instructions', 300)] }));
		expect(bands()).toEqual([
			{ name: 'Instructions', x: 0, width: 120, hue: 'text-facet-1' },
			{ name: NOT_LISTED, x: 120, width: 40, hue: 'text-muted-foreground' }
		]);
		expect(lines()[0]).toBe('400 of 1k');
	});

	it('is the whole of the fill where no breakdown has arrived', () => {
		draw(usage({ total: 250, limit: 1000 }));
		expect(bands()).toEqual([{ name: NOT_LISTED, x: 0, width: 100, hue: 'text-muted-foreground' }]);
	});

	it('never draws the fill under what the bands already account for', () => {
		draw(usage({ total: 0, limit: 1000, parts: [part('Instructions', 300)] }));
		expect(bands().map((one) => one.name)).toEqual(['Instructions']);
		expect(lines()[0]).toBe('300 of 1k');
	});
});

describe('the list under the bar', () => {
	it('is closed until somebody asks for it', () => {
		draw(usage({ total: 300, limit: 1000, parts: [part('Instructions', 300)] }));
		expect(legend()).toEqual([]);
		expect(target.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
	});

	it('opens on the bar, one row per band and what it holds', () => {
		draw(
			usage({
				total: 400,
				limit: 1000,
				parts: [
					part('Instructions', 100),
					part('Conversation', 300),
					part('Room to answer', 50, 'buffer')
				]
			})
		);
		target.querySelector('button')?.click();
		flushSync();
		expect(legend()).toEqual([
			'Instructions 100 10%',
			'Conversation 300 30%',
			'Room to answer 50 5%'
		]);
		expect(target.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');
	});

	it('opens where the caller says it is open', () => {
		draw(usage({ total: 300, limit: 1000, parts: [part('Instructions', 300)] }), { open: true });
		expect(legend()).toEqual(['Instructions 300 30%']);
	});

	it('draws every swatch the way the bar draws its band', () => {
		draw(
			usage({
				total: 400,
				limit: 1000,
				parts: [part('Instructions', 300), part('Room to answer', 100, 'buffer')]
			}),
			{ open: true }
		);
		expect(listLooks()).toEqual(looks());
		const bar = target.querySelector('rect[data-kept]')?.getAttribute('fill');
		expect(swatchPaints()).toEqual([bar]);
	});

	it('opens from a target a finger can hit, whatever the bar is drawn at', () => {
		draw(usage({ total: 300, limit: 1000, parts: [part('Instructions', 300)] }));
		expect(target.querySelector('button')?.className).toContain('min-h-control');
	});

	it('offers nothing to open where there is nothing in the window', () => {
		draw(usage({ total: 0, limit: 1000 }));
		expect(target.querySelector('button')).toBeNull();
	});
});

describe('the whole bar as a sentence', () => {
	it('reads the fill, the bands, what is held aside and where it makes room', () => {
		draw(
			usage({
				total: 48_200,
				limit: 200_000,
				compactsAt: 160_000,
				parts: [
					part('Instructions', 12_100),
					part('Conversation', 36_100),
					part('Room to answer', 15_000, 'buffer'),
					part('Tool definitions', 24_000, 'deferred')
				]
			})
		);
		expect(sentence()).toBe(
			'48k of 200k tokens. Instructions 12k, Conversation 36k, Room to answer 15k. ' +
				'24k held aside. Compacts at 160k.'
		);
	});

	it('says what a turn that made room came down from', () => {
		draw(usage({ total: 2000, limit: 10_000, compacted: { from: 9200 } }));
		expect(sentence()).toBe('2k of 10k tokens. Not yet listed 2k. Compacted from 9.2k.');
	});
});

describe('at the dock at its least width', () => {
	it('keeps every band inside the bar', () => {
		room(352);
		draw(
			usage({
				total: 1000,
				limit: 1000,
				parts: [part('Instructions', 400), part('Conversation', 600)]
			})
		);
		for (const band of bands()) expect(band.x + band.width).toBeLessThanOrEqual(352.0001);
		expect(bands().at(-1)?.width).toBeCloseTo(352 * 0.6, 3);
	});
});

describe('the bar as numbers', () => {
	it('lays a band out against the window, not against the bands beside it', () => {
		const bar = barOf(usage({ total: 300, limit: 1000, parts: [part('A', 100), part('B', 200)] }));
		expect(spans(bar, 500)).toEqual([
			{ band: { name: 'A', tokens: 100, hue: 'text-facet-1' }, from: 0, width: 50 },
			{ band: { name: 'B', tokens: 200, hue: 'text-facet-2' }, from: 50, width: 100 }
		]);
	});

	it('reads a share as a reader reads one', () => {
		expect(shareSaid(300, 1000)).toBe('30%');
		expect(shareSaid(2, 1000)).toBe('<1%');
		expect(shareSaid(0, 1000)).toBe('0%');
	});

	it('says nothing about bands where there are none', () => {
		expect(contextSaid(barOf(usage({ total: 0, limit: 1000 })))).toBe('0 of 1k tokens.');
	});
});
