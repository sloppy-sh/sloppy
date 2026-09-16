// The lanes a page of versions falls into, and what the picture draws them as.

import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type DrawnVersion, placed } from './commit-graph.js';
import CommitGraph from './commit-graph.svelte';

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let opened: string[];

function version(id: string, parents: string[], over: Partial<DrawnVersion> = {}): DrawnVersion {
	return { id, message: id, when: '1 Jan 2026', parents, refs: [], ...over };
}

/** Whether the surface has room for a lane per line. */
function room(wide: boolean): void {
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: (query: string) => ({
			matches: query.includes('max-width') ? !wide : wide,
			addEventListener: () => {},
			removeEventListener: () => {}
		})
	});
}

function draw(versions: DrawnVersion[], at?: string): void {
	mounted = mount(CommitGraph, {
		target,
		props: {
			versions,
			...(at === undefined ? {} : { at }),
			onOlder: () => {},
			onOpen: (id: string) => opened.push(id)
		}
	});
	flushSync();
}

function lanes(): [string, string][] {
	return [...target.querySelectorAll('li')].map((one) => [
		one.getAttribute('data-version') ?? '',
		one.getAttribute('data-lane') ?? ''
	]);
}

/** How dark each mark is drawn, by the version it stands for. */
function marks(): number[] {
	return [...target.querySelectorAll('circle')].map((one) =>
		Number(one.getAttribute('opacity') ?? '1')
	);
}

beforeEach(() => {
	room(true);
	opened = [];
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.body.innerHTML = '';
});

describe('the lanes a page of versions falls into', () => {
	it('keeps one line in one lane', () => {
		const laid = placed([
			{ id: 'c', parents: ['b'] },
			{ id: 'b', parents: ['a'] },
			{ id: 'a', parents: [] }
		]);

		expect(laid.map((one) => one.lane)).toEqual([0, 0, 0]);
		expect(laid.map((one) => one.springs)).toEqual([
			[{ row: 1, lane: 0 }],
			[{ row: 2, lane: 0 }],
			[]
		]);
		expect(laid.map((one) => one.older)).toEqual([false, false, false]);
	});

	it('gives a line that left another its own lane, and takes it back at the fork', () => {
		const laid = placed([
			{ id: 'c', parents: ['a'] },
			{ id: 'b', parents: ['a'] },
			{ id: 'a', parents: [] }
		]);

		expect(laid.map((one) => one.lane)).toEqual([0, 1, 0]);
		expect(laid[1].springs).toEqual([{ row: 2, lane: 0 }]);
	});

	it('draws a merge as two lines coming into one version', () => {
		const laid = placed([
			{ id: 'm', parents: ['c', 'b'] },
			{ id: 'c', parents: ['a'] },
			{ id: 'b', parents: ['a'] },
			{ id: 'a', parents: [] }
		]);

		expect(laid.map((one) => one.lane)).toEqual([0, 0, 1, 0]);
		expect(laid[0].springs).toEqual([
			{ row: 1, lane: 0 },
			{ row: 2, lane: 1 }
		]);
	});

	it('says where a line leaves the bottom of the page', () => {
		const laid = placed([
			{ id: 'b', parents: ['a'] },
			{ id: 'a', parents: ['older'] }
		]);

		expect(laid[1].older).toBe(true);
		expect(laid[1].springs).toEqual([]);
	});
});

describe('the picture on the page', () => {
	it('draws every line in its own lane where there is room', () => {
		draw([version('c', ['a']), version('b', ['a']), version('a', [])]);

		expect(lanes()).toEqual([
			['c', '0'],
			['b', '1'],
			['a', '0']
		]);
	});

	it('collapses to one column at phone width, and marks where two came together', () => {
		room(false);

		draw([version('m', ['c', 'b']), version('c', ['a']), version('b', ['a']), version('a', [])]);

		expect(lanes().map(([, lane]) => lane)).toEqual(['0', '0', '0', '0']);
		expect(target.querySelectorAll('circle[fill="none"]')).toHaveLength(1);
	});

	it('draws the line the folder is on at full ink and every other at half', () => {
		draw([version('c', ['a']), version('b', ['a']), version('a', [])], 'c');

		expect(marks()).toEqual([1, 0.45, 1]);
	});

	it('draws a line into another lane at that lane’s ink, so a merge claims nothing', () => {
		draw(
			[version('m', ['c', 'b']), version('c', ['a']), version('b', ['a']), version('a', [])],
			'm'
		);

		expect([...target.querySelectorAll('path')].map((one) => one.getAttribute('opacity'))).toEqual([
			'1',
			'0.45',
			'1',
			'0.45'
		]);
	});

	it('names the branches at a version, and opens the one somebody taps', () => {
		draw([version('c', ['a'], { refs: ['main', 'origin/main'] }), version('a', [])]);

		expect(target.textContent).toContain('main');
		expect(target.textContent).toContain('origin/main');

		target.querySelector<HTMLButtonElement>('li button')?.click();
		flushSync();

		expect(opened).toEqual(['c']);
	});
});
