// The table the history is drawn as.

import { TAG_HUE_SLOTS } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DrawnVersion } from './commit-graph.js';
import CommitGraph, { HUES } from './commit-graph.svelte';

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let opened: string[];

function version(id: string, parents: string[], over: Partial<DrawnVersion> = {}): DrawnVersion {
	return { id, message: id, when: '1 Jan 2026', parents, refs: [], ...over };
}

/** Whether the surface has room for date, author and name beside the message. */
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

function draw(
	versions: DrawnVersion[],
	over: { at?: string; on?: string; elsewhere?: string[]; signs?: boolean } = {}
): void {
	mounted = mount(CommitGraph, {
		target,
		props: {
			versions,
			signs: false,
			...over,
			onOlder: () => {},
			onOpen: (id: string) => opened.push(id)
		}
	});
	flushSync();
}

function rows(): HTMLLIElement[] {
	return [...target.querySelectorAll('li')];
}

/** Which lane each version was drawn in, by the version it stands for. */
function lanes(): [string, string][] {
	return rows().map((one) => [
		one.getAttribute('data-version') ?? '',
		one.getAttribute('data-lane') ?? ''
	]);
}

/** The hue each version's own mark draws in, by row. */
function hues(): (string | null)[] {
	return rows().map((one) => one.querySelector('circle')?.getAttribute('class') ?? null);
}

function said(one: Element): string {
	return (one.textContent ?? '').replace(/\s+/g, ' ').trim();
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

describe('a row per version', () => {
	it('carries the message, when it was kept, who kept it and its short name', () => {
		draw([version('9f3c1a2b4d', ['a'], { message: 'A first version', author: 'Ada' })]);

		const row = said(rows()[0]);
		expect(row).toContain('A first version');
		expect(row).toContain('1 Jan 2026');
		expect(row).toContain('Ada');
		expect(row).toContain('9f3c1a2b');
		expect(row).not.toContain('9f3c1a2b4d');
	});

	it('names the branches at a version, and opens the one somebody taps', () => {
		draw([version('c', ['a'], { refs: ['main', 'origin/main'] }), version('a', [])]);

		expect(said(rows()[0])).toContain('main');
		expect(said(rows()[0])).toContain('origin/main');

		rows()[0].querySelector('button')?.click();
		flushSync();

		expect(opened).toEqual(['c']);
	});

	it('draws a branch kept somewhere else apart from one kept here', () => {
		draw([version('c', [], { refs: ['main', 'origin/main'] })], { elsewhere: ['origin/main'] });

		const chips = [...rows()[0].querySelectorAll('span')].filter((one) =>
			['main', 'origin/main'].includes(said(one))
		);
		expect(chips.map((one) => one.className.includes('border-dashed'))).toEqual([false, true]);
	});

	it('draws a branch kept here whose name has a slash in it as kept here', () => {
		draw([version('c', [], { refs: ['theme/git-graph', 'origin/theme/git-graph'] })], {
			elsewhere: ['origin/theme/git-graph']
		});

		const chips = [...rows()[0].querySelectorAll('span')].filter((one) =>
			['theme/git-graph', 'origin/theme/git-graph'].includes(said(one))
		);
		expect(chips.map((one) => one.className.includes('border-dashed'))).toEqual([false, true]);
	});

	it('marks the line the folder is on', () => {
		draw([version('c', [], { refs: ['main', 'an-argument'] })], { on: 'an-argument' });

		const chips = [...rows()[0].querySelectorAll('span')].filter((one) =>
			['main', 'an-argument'].includes(said(one))
		);
		expect(chips.map((one) => one.className.includes('border-foreground'))).toEqual([false, true]);
	});

	it('draws the version the folder stands on as an open mark', () => {
		draw([version('c', ['a']), version('a', [])], { at: 'c' });

		const marks = [...target.querySelectorAll('li circle')];
		expect(marks[0].getAttribute('fill')).not.toBe('currentColor');
		expect(marks[0].getAttribute('stroke')).toBe('currentColor');
		expect(marks[1].getAttribute('fill')).toBe('currentColor');
	});

	it('says a version went unsigned where the folder signs', () => {
		draw([version('c', [])], { signs: true });

		expect(said(rows()[0])).toContain('Kept unsigned');
	});

	it('says nothing of a signature where the folder signs with none', () => {
		draw([version('c', [])]);

		expect(said(rows()[0])).not.toContain('Kept unsigned');
	});

	it('says nothing of a signature on a version that carries one', () => {
		draw([version('c', [], { signed: { by: 'a key', verified: true } })], { signs: true });

		expect(said(rows()[0])).not.toContain('Kept unsigned');
		expect(said(rows()[0])).toContain('Signed.');
	});
});

describe('the lanes beside the rows', () => {
	it('gives a line that left another a lane of its own', () => {
		draw([version('c', ['a']), version('b', ['a']), version('a', [])]);

		expect(lanes()).toEqual([
			['c', '0'],
			['b', '1'],
			['a', '0']
		]);
	});

	it('keeps them where there is no room for the other columns', () => {
		room(false);

		draw([version('c', ['a']), version('b', ['a']), version('a', [])]);

		expect(lanes().map(([, lane]) => lane)).toEqual(['0', '1', '0']);
	});

	it('draws each lane in its own hue, from the ramp the canvas lends a tag', () => {
		draw([version('c', ['a']), version('b', ['a']), version('a', [])]);

		expect(hues()).toEqual(['text-facet-1', 'text-facet-2', 'text-facet-1']);
	});

	it('spends no more hues than the ramp holds', () => {
		expect(HUES).toHaveLength(TAG_HUE_SLOTS.length);

		// Nine lines that never end, so the ninth can only wrap onto the first.
		const many = Array.from({ length: HUES.length + 1 }, (_, one) =>
			version(`tip-${one}`, ['root'])
		);
		draw([...many, version('root', [])]);

		expect(hues().slice(0, HUES.length + 1)).toEqual([...HUES, HUES[0]]);
	});

	it('draws a line down to the row under it, and the rest of it on that row', () => {
		draw([version('b', ['a']), version('a', [])]);

		expect(rows()[0].querySelectorAll('path')).toHaveLength(1);
		expect(rows()[1].querySelectorAll('path')).toHaveLength(1);
	});

	it('draws no line under a version that springs from nothing', () => {
		draw([version('a', []), version('b', ['nothing here'])]);

		expect(target.querySelectorAll('path')).toHaveLength(0);
	});
});
