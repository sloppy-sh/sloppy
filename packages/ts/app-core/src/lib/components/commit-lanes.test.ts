// The lanes a page of versions falls into.

import { describe, expect, it } from 'vitest';
import { type LaneCommit, type Lanes, lanes } from './commit-lanes.js';

function version(id: string, ...parents: string[]): LaneCommit {
	return { id, parents };
}

/** Where each version sits, by row. */
function laneOf(laid: Lanes): number[] {
	return laid.places.map((place) => place.lane);
}

/** The hue each version's lane draws in, by row. */
function hueOf(laid: Lanes): number[] {
	return laid.places.map((place) => laid.hues[place.line]);
}

describe('one line of versions', () => {
	it('keeps every version in one lane', () => {
		const laid = lanes([version('c', 'b'), version('b', 'a'), version('a')]);

		expect(laneOf(laid)).toEqual([0, 0, 0]);
		expect(laid.width).toBe(1);
		expect(laid.links).toEqual([
			{ row: 0, from: 0, to: 0, line: 0 },
			{ row: 1, from: 0, to: 0, line: 0 }
		]);
	});

	it('draws nothing for a page with nothing on it', () => {
		const laid = lanes([]);

		expect(laid.places).toEqual([]);
		expect(laid.links).toEqual([]);
		expect(laid.width).toBe(1);
	});
});

describe('a line that left another', () => {
	it('takes a lane of its own, and comes back to the fork', () => {
		const laid = lanes([version('c', 'a'), version('b', 'a'), version('a')]);

		expect(laneOf(laid)).toEqual([0, 1, 0]);
		expect(laid.width).toBe(2);
		expect(laid.links).toContainEqual({ row: 1, from: 1, to: 0, line: 1 });
	});

	it('draws in a hue of its own', () => {
		const laid = lanes([version('c', 'a'), version('b', 'a'), version('a')]);

		expect(hueOf(laid)).toEqual([0, 1, 0]);
	});
});

describe('a version that brought a line in', () => {
	it('is where the two lanes come together', () => {
		const laid = lanes([
			version('m', 'c', 'b'),
			version('c', 'a'),
			version('b', 'a'),
			version('a')
		]);

		expect(laneOf(laid)).toEqual([0, 0, 1, 0]);
		expect(laid.links).toContainEqual({ row: 0, from: 0, to: 1, line: 1 });
		expect(laid.links).toContainEqual({ row: 2, from: 1, to: 0, line: 1 });
	});

	it('frees the lane and the hue it closed for a line further down', () => {
		const laid = lanes([
			version('m', 'c', 'b'),
			version('c', 'a'),
			version('b', 'a'),
			version('a', 'z'),
			version('y', 'z'),
			version('z')
		]);

		expect(laneOf(laid)).toEqual([0, 0, 1, 0, 1, 0]);
		expect(hueOf(laid)).toEqual([0, 0, 1, 0, 1, 0]);
		// The line `b` is on and the line `y` is on are two lines, one hue.
		expect(laid.places[2].line).not.toBe(laid.places[4].line);
	});
});

describe('a version older than the page', () => {
	it('leaves a line running off the bottom of it', () => {
		const laid = lanes([version('b', 'older'), version('a')]);

		expect(laneOf(laid)).toEqual([0, 1]);
		expect(laid.links).toEqual([{ row: 0, from: 0, to: 0, line: 0 }]);
	});

	it('draws a version above what it springs from as one older than the page', () => {
		const laid = lanes([version('a'), version('b', 'a')]);

		expect(laneOf(laid)).toEqual([0, 0]);
		expect(laid.links).toEqual([]);
	});
});

describe('a version that springs from nothing', () => {
	it('ends its line there, with nothing drawn under it', () => {
		const laid = lanes([version('b', 'a'), version('a'), version('z', 'y'), version('y')]);

		expect(laid.links).toEqual([
			{ row: 0, from: 0, to: 0, line: 0 },
			{ row: 2, from: 0, to: 0, line: 1 }
		]);
		expect(laneOf(laid)).toEqual([0, 0, 0, 0]);
	});
});

/** A deterministic roll, so a seed that fails can be run again. */
function rolls(seed: number): () => number {
	let held = seed >>> 0;
	return () => {
		held = (held * 1664525 + 1013904223) >>> 0;
		return held / 0x100000000;
	};
}

function oneOf(held: readonly string[], roll: () => number): string {
	return held[Math.floor(roll() * held.length) % held.length];
}

/** A history the way one grows: versions kept on a handful of lines that fork,
 *  are added to, and come back together. Newest first, as `graph()` answers. */
function history(seed: number, many: number): LaneCommit[] {
	const roll = rolls(seed);
	const oldest: LaneCommit[] = [];
	const tips: string[] = [];
	for (let n = 0; n < many; n += 1) {
		const id = `v${n}`;
		const chance = roll();
		if (tips.length === 0 || chance < 0.06) {
			oldest.push({ id, parents: [] });
		} else if (tips.length > 1 && chance < 0.24) {
			const one = oneOf(tips, roll);
			const two = oneOf(
				tips.filter((tip) => tip !== one),
				roll
			);
			oldest.push({ id, parents: [one, two] });
			tips.splice(tips.indexOf(two), 1);
			tips.splice(tips.indexOf(one), 1);
		} else {
			const one = oneOf(tips, roll);
			oldest.push({ id, parents: [one] });
			if (roll() < 0.75) tips.splice(tips.indexOf(one), 1);
		}
		tips.push(id);
	}
	return oldest.reverse();
}

/** The lanes anything touches on one row: where its own version sits, and where
 *  every line through it leaves and arrives. */
function touched(laid: Lanes, row: number): Set<number> {
	const held = new Set([laid.places[row].lane]);
	for (const link of laid.links) {
		if (link.row === row) held.add(link.from);
		if (link.row === row - 1) held.add(link.to);
	}
	return held;
}

/** Whether one line runs, row by row, from a lane on one row to a lane further
 *  down — which is what makes a version's line to what it springs from a line a
 *  reader can follow rather than two marks that happen to be coloured alike. */
function runs(laid: Lanes, from: number, fromLane: number, to: number, toLane: number): boolean {
	for (let line = 0; line < laid.hues.length; line += 1) {
		let here = new Set([fromLane]);
		for (let row = from; row < to && here.size > 0; row += 1) {
			const next = new Set<number>();
			for (const link of laid.links) {
				if (link.row === row && link.line === line && here.has(link.from)) next.add(link.to);
			}
			here = next;
		}
		if (here.has(toLane)) return true;
	}
	return false;
}

describe('any history at all', () => {
	const SEEDS = 150;
	const KEPT = 60;

	/** The whole history, and the newest part of one, which is what a first page
	 *  is: the oldest versions on it spring from ones nobody has read yet. */
	function pages(seed: number): LaneCommit[][] {
		const whole = history(seed, KEPT);
		return [whole, whole.slice(0, Math.max(2, Math.floor(KEPT / 3)))];
	}

	it('gives every version a lane on a line', { timeout: 30_000 }, () => {
		for (let seed = 1; seed <= SEEDS; seed += 1) {
			for (const page of pages(seed)) {
				const laid = lanes(page);
				expect(laid.places, `${seed}`).toHaveLength(page.length);
				for (const place of laid.places) {
					expect(place.lane, `${seed}`).toBeGreaterThanOrEqual(0);
					expect(place.lane, `${seed}`).toBeLessThan(laid.width);
					expect(laid.hues[place.line], `${seed}`).toBeGreaterThanOrEqual(0);
				}
			}
		}
	});

	it('fills the lanes from the left, so one a line gave up is taken again', () => {
		for (let seed = 1; seed <= SEEDS; seed += 1) {
			for (const page of pages(seed)) {
				const laid = lanes(page);
				for (let row = 0; row < laid.places.length; row += 1) {
					const held = [...touched(laid, row)].sort((a, b) => a - b);
					expect(held, `${seed} row ${row}`).toEqual(held.map((_, lane) => lane));
				}
			}
		}
	});

	it('runs a line from every version down to what it springs from', { timeout: 60_000 }, () => {
		for (let seed = 1; seed <= SEEDS; seed += 1) {
			for (const page of pages(seed)) {
				const laid = lanes(page);
				const at = new Map(page.map((one, row) => [one.id, row]));
				for (const [row, one] of page.entries()) {
					for (const parent of one.parents) {
						const springs = at.get(parent);
						if (springs === undefined) continue;
						expect(
							runs(laid, row, laid.places[row].lane, springs, laid.places[springs].lane),
							`${seed}: ${one.id} to ${parent}`
						).toBe(true);
					}
				}
			}
		}
	});

	it('draws a line only between one row and the row under it', () => {
		for (let seed = 1; seed <= SEEDS; seed += 1) {
			for (const page of pages(seed)) {
				const laid = lanes(page);
				for (const link of laid.links) {
					expect(link.row, `${seed}`).toBeGreaterThanOrEqual(0);
					expect(link.row, `${seed}`).toBeLessThan(page.length - 1);
					expect(Math.max(link.from, link.to), `${seed}`).toBeLessThan(laid.width);
				}
			}
		}
	});

	it('draws the same page the same way every time', () => {
		for (let seed = 1; seed <= SEEDS; seed += 1) {
			const page = history(seed, KEPT);
			const again = page.map((one) => ({ id: one.id, parents: [...one.parents] }));
			expect(lanes(page), `${seed}`).toEqual(lanes(again));
		}
	});
});
