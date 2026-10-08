// @vitest-environment jsdom
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chromeInset } from './chrome-inset.svelte.js';
import { stubMediaQuery, stubResizeObserver } from './dom.test-support.js';
import SideDock from './side-dock.svelte';

const body = createRawSnippet(() => ({ render: () => '<p data-testid="body">a thought</p>' }));

let target: HTMLElement;
let up: ReturnType<typeof mount>[];

/** What `<html>` is told everything docked on the right takes, together. */
const owed = () => document.documentElement.style.getPropertyValue('--reading-dock-inset-right');

const dockNamed = (title: string) =>
	document.body.querySelector<HTMLElement>(`aside[aria-label="${title}"]`);

const wallNamed = (title: string) =>
	dockNamed(title)?.querySelector<HTMLElement>('[role="separator"]') ?? null;

function windowIs(px: number): void {
	Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: px });
}

function dock(
	title: string,
	over: { outer?: number; width?: number | null; open?: boolean } = {}
): ReturnType<typeof mount> {
	const one = mount(SideDock, {
		target,
		props: { open: true, title, wall: `How much room ${title} takes`, children: body, ...over }
	});
	up.push(one);
	flushSync();
	return one;
}

function takeDown(one: ReturnType<typeof mount>): void {
	up = up.filter((held) => held !== one);
	unmount(one, { outro: false });
	flushSync();
}

beforeEach(() => {
	stubResizeObserver();
	stubMediaQuery(() => true);
	windowIs(1600);
	up = [];
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	for (const one of up) unmount(one, { outro: false });
	up = [];
	target.remove();
	document.body.innerHTML = '';
	document.documentElement.style.removeProperty('--reading-dock-inset-right');
	chromeInset.takes(0);
});

describe('a dock beside the graph', () => {
	it('stands beside it where there is room for both, rather than over it', () => {
		dock('Chat', { width: 400 });

		expect(dockNamed('Chat')).not.toBeNull();
		expect(document.body.querySelector('[role="dialog"]')).toBeNull();
		expect(owed()).toBe('400px');
	});

	it('is the whole screen where there is not, and owes the page nothing', () => {
		stubMediaQuery(() => false);
		dock('Chat', { width: 400 });

		expect(dockNamed('Chat')).toBeNull();
		expect(document.body.querySelector('[data-slot="modal-grabber"]')).not.toBeNull();
		expect(owed()).toBe('');
	});

	it('names its wall for what the wall moves', () => {
		dock('Chat', { width: 400 });

		expect(wallNamed('Chat')?.getAttribute('aria-label')).toBe('How much room Chat takes');
	});
});

// Reading a note while chatting about it is the whole point of a side view, so
// the two stand together and the page gives up what they take TOGETHER.
describe('a note and the chat docked at once', () => {
	function both(): void {
		dock('Chat', { outer: 1, width: 400 });
		dock('Note', { outer: 0, width: 360 });
	}

	it('owes the page one width, the total of what they take', () => {
		both();

		expect(owed()).toBe('760px');
	});

	it('stands the note between the chat and the graph', () => {
		both();

		expect(dockNamed('Chat')?.style.right).toBe('0px');
		expect(dockNamed('Note')?.style.right).toBe('400px');
	});

	it('gives back only what leaves, and the var goes with the last of them', () => {
		dock('Chat', { outer: 1, width: 400 });
		const note = dock('Note', { outer: 0, width: 360 });

		takeDown(note);
		expect(owed()).toBe('400px');

		takeDown(up[0]);
		expect(owed()).toBe('');
	});

	// DESIGN.md § Layout: a dock is never so wide that what it is docked against
	// stops being a graph — which two of them have to answer between them.
	it('leaves the graph its room however far both walls are pushed', () => {
		dock('Chat', { outer: 1, width: 5000 });
		dock('Note', { outer: 0, width: 5000 });

		const took = Number(owed().replace('px', ''));
		expect(window.innerWidth - took).toBeGreaterThanOrEqual(448);
	});

	it('leaves the graph its room beside a column standing at the other edge', () => {
		windowIs(1300);
		chromeInset.takes(256);
		dock('Note', { outer: 0, width: 5000 });

		expect(dockNamed('Note')).not.toBeNull();
		expect(Number(owed().replace('px', ''))).toBeLessThanOrEqual(1300 - 256 - 448);
	});

	it('is a sheet where the column at the other edge leaves it no room to dock', () => {
		windowIs(1000);
		chromeInset.takes(256);
		dock('Note', { outer: 0, width: 400 });

		expect(dockNamed('Note')).toBeNull();
		expect(owed()).toBe('');
	});

	it('opens the second as a sheet where docking it would leave no graph', () => {
		windowIs(1000);
		dock('Chat', { outer: 1, width: 5000 });
		dock('Note', { outer: 0, width: 400 });

		expect(dockNamed('Chat')).not.toBeNull();
		expect(dockNamed('Note')).toBeNull();
		expect(Number(owed().replace('px', ''))).toBeLessThanOrEqual(1000 - 448);
	});
});

describe('a dock filling the page', () => {
	it('spans the page over the other docks, keeps its place in the stack, and comes back', () => {
		dock('Chat', { outer: 1 });
		const note = dock('Note', { width: 420 });
		const owedBefore = owed();
		expect((dockNamed('Note') as HTMLElement).dataset.fills).toBeUndefined();

		// Asked to fill the page.
		takeDown(note);
		const filling = mount(SideDock, {
			target,
			props: {
				open: true,
				title: 'Note',
				wall: 'How much room Note takes',
				children: body,
				width: 420,
				full: true
			}
		});
		up.push(filling);
		flushSync();

		const full = dockNamed('Note') as HTMLElement;
		expect(full.dataset.fills).toBe('');
		expect(full.style.right).toBe('0px');
		expect(full.style.left).toContain('--app-chrome-inset-start');
		expect(full.style.width).toBe('');
		expect(Number(full.style.zIndex)).toBeGreaterThan(
			Number((dockNamed('Chat') as HTMLElement).style.zIndex)
		);
		expect(wallNamed('Note')?.hidden).toBe(true);
		// What the page is owed is unchanged: the room it took beside the graph.
		expect(owed()).toBe(owedBefore);
	});

	it('comes back beside the graph on Escape, and closes on the next', () => {
		let fulls: boolean[] = [];
		let opens: boolean[] = [];
		const one = mount(SideDock, {
			target,
			props: {
				open: true,
				title: 'Note',
				wall: 'How much room Note takes',
				children: body,
				full: true,
				onFullChange: (to: boolean) => fulls.push(to),
				onOpenChange: (to: boolean) => opens.push(to)
			}
		});
		up.push(one);
		flushSync();

		const aside = dockNamed('Note') as HTMLElement;
		aside.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		flushSync();
		expect(fulls).toEqual([false]);
		expect(opens).toEqual([]);
		expect(aside.dataset.fills).toBeUndefined();

		aside.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		flushSync();
		expect(opens).toEqual([false]);
	});
});
