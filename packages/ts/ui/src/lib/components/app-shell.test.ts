// @vitest-environment jsdom
import HouseIcon from '@lucide/svelte/icons/house';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Harness from './app-shell-harness.test.svelte';
import { chromeInset } from './chrome-inset.svelte.js';
import { columnWidth, columnWithin } from './desk-nav.svelte';
import { DESK_FROM_PX } from './desk-nav.svelte.js';
import { docksRight } from './dock-stack.svelte.js';
import { type MediaQueryStub, stubMediaQuery, stubResizeObserver } from './dom.test-support.js';
import { overlay } from './overlay.svelte.js';

const ITEMS = [{ id: 'graph', label: 'Graph', href: '/', icon: HouseIcon }];

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let mounts = 0;
let viewport: MediaQueryStub;

const OVER = () => false;
const BESIDE = (query: string) => query.includes(`min-width: ${DESK_FROM_PX}px`);

function render(props: Record<string, unknown> = {}) {
	mounts = 0;
	mounted = mount(Harness, {
		target,
		props: { items: ITEMS, onmount: () => mounts++, ...props }
	});
	flushSync();
}

const pages = () => target.querySelectorAll('[data-testid="page"]').length;

beforeEach(() => {
	stubResizeObserver();
	viewport = stubMediaQuery(OVER);
	// jsdom lays nothing out, so the column measures the width its own class
	// names — the column's own width open, its rail width narrowed.
	Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
		configurable: true,
		get(this: HTMLElement) {
			if (this.classList.contains('w-(--desk-nav-width)')) return 256;
			return this.classList.contains('w-(--desk-nav-rail)') ? 56 : 0;
		}
	});
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.documentElement.style.removeProperty('--sysnav-inset-bottom');
	document.documentElement.style.removeProperty('--app-chrome-inset-start');
});

/** The floating pill is the nav that stands outside the sidebar. */
const pill = () => [...target.querySelectorAll('nav')].find((nav) => !nav.closest('aside')) ?? null;
const sidebar = () => target.querySelector('aside');
const clearsThePill = () =>
	document.documentElement.style.getPropertyValue('--sysnav-inset-bottom');
const clearsTheColumn = () =>
	document.documentElement.style.getPropertyValue('--app-chrome-inset-start');

describe('the app shell', () => {
	it('renders the page exactly once', () => {
		render();
		expect(pages()).toBe(1);
		expect(mounts).toBe(1);
	});

	// PRODUCT.md § "Accessibility & Inclusion": semantic landmarks. `contents`
	// keeps the landmark out of the layout the canvas is positioned against.
	it('gives every page a main region that lays nothing out', () => {
		render();
		const main = target.querySelector('main');
		expect(main?.className).toBe('contents');
		expect(main?.querySelector('[data-testid="page"]')).not.toBeNull();
		expect(main?.querySelector('nav')).toBeNull();
	});

	it('does not remount the page when a modal suppresses the nav', () => {
		render();
		const release = overlay.push(() => {});
		flushSync();
		expect(target.querySelector('nav')?.inert).toBe(true);
		expect(mounts).toBe(1);
		expect(pages()).toBe(1);
		release();
		flushSync();
		expect(target.querySelector('nav')?.inert).toBe(false);
		expect(mounts).toBe(1);
	});

	it('draws no nav where there is nowhere to go', () => {
		render({ items: [] });
		expect(target.querySelector('nav')).toBeNull();
		expect(pages()).toBe(1);
	});

	it('draws no nav on a surface that is not yet inside the app', () => {
		render({ showNav: false });
		expect(target.querySelector('nav')).toBeNull();
	});
});

// DESIGN.md § Layout: two arrangements of the same parts, flipping at the width
// the docks already stand at.
describe('the chrome beside the graph', () => {
	it('stands as a column at the dock width, with no pill over the canvas', () => {
		viewport = stubMediaQuery(BESIDE);
		render();
		expect(sidebar()).not.toBeNull();
		expect(pill()).toBeNull();
	});

	it('leaves the bottom of the page to the page, since no pill stands on it', () => {
		render();
		expect(clearsThePill()).not.toBe('');
		viewport.change(BESIDE);
		flushSync();
		expect(clearsThePill()).toBe('');
	});

	it('does not remount the page when the window crosses that width', () => {
		render();
		expect(pages()).toBe(1);
		viewport.change(BESIDE);
		flushSync();
		expect(sidebar()).not.toBeNull();
		viewport.change(OVER);
		flushSync();
		expect(pill()).not.toBeNull();
		expect(mounts).toBe(1);
		expect(pages()).toBe(1);
	});

	it('carries the same destinations the pill carries', () => {
		viewport = stubMediaQuery(BESIDE);
		render();
		const links = [...(sidebar()?.querySelectorAll('a') ?? [])];
		expect(links.map((link) => link.getAttribute('href'))).toEqual(ITEMS.map((one) => one.href));
		expect(sidebar()?.textContent).toContain('Graph');
	});

	it('holds what the page standing in it puts there', () => {
		viewport = stubMediaQuery(BESIDE);
		render({ fills: true });
		expect(sidebar()?.querySelector('[data-testid="parts"]')?.textContent).toBe('a column');
	});

	it("stands the page's head beside its own toggle, however narrow", () => {
		viewport = stubMediaQuery(BESIDE);
		render({ fills: true });
		const head = sidebar()?.firstElementChild;
		expect(head?.querySelector('[data-testid="head"]')?.textContent).toBe('wide');
		expect(head?.querySelector('button[aria-expanded="true"]')).not.toBeNull();

		render({ deskNavOpen: false, fills: true });
		const rail = target.querySelectorAll('aside')[1]?.firstElementChild;
		expect(rail?.querySelector('[data-testid="head"]')?.textContent).toBe('narrow');
		expect(rail?.querySelector('button[aria-expanded="false"]')).not.toBeNull();
	});

	it('stands for a page with parts to put there even where there is nowhere to go', () => {
		viewport = stubMediaQuery(BESIDE);
		render({ items: [], fills: true });
		expect(sidebar()?.querySelector('[data-testid="parts"]')).not.toBeNull();
	});

	it('narrows to an icon rail, keeping every control labelled', () => {
		viewport = stubMediaQuery(BESIDE);
		render({ deskNavOpen: false, fills: true });
		expect(sidebar()?.querySelector('[data-testid="parts"]')?.textContent).toBe('an icon rail');
		const link = sidebar()?.querySelector('a');
		expect(link?.textContent?.trim()).toBe('');
		expect(link?.getAttribute('aria-label')).toBe('Graph');
	});

	// DESIGN.md § "The four inset vars": what floats over the page is placed
	// against what the column left, not against the whole window.
	it('owes the room it takes, and owes nothing where it does not stand', () => {
		render();
		expect(clearsTheColumn()).toBe('');
		viewport.change(BESIDE);
		flushSync();
		expect(clearsTheColumn()).toBe('256px');
		viewport.change(OVER);
		flushSync();
		expect(clearsTheColumn()).toBe('');
	});

	it('owes only the rail once it is narrowed to one', () => {
		viewport = stubMediaQuery(BESIDE);
		render({ deskNavOpen: false });
		expect(clearsTheColumn()).toBe('56px');
	});

	it('gives the widening a target a finger can hit', () => {
		viewport = stubMediaQuery(BESIDE);
		render();
		const toggle = sidebar()?.querySelector('button[aria-expanded]');
		expect(toggle?.className).toContain('min-h-control');
		expect(toggle?.className).toContain('min-w-control');
	});

	it('hands the widening back to whoever keeps it', () => {
		viewport = stubMediaQuery(BESIDE);
		const asked: boolean[] = [];
		render({ deskNavOpen: false, onDeskNavOpenChange: (open: boolean) => asked.push(open) });
		sidebar()?.querySelector<HTMLButtonElement>('button[aria-expanded]')?.click();
		flushSync();
		expect(asked).toEqual([true]);
	});

	it('draws no column on a surface that is not yet inside the app', () => {
		viewport = stubMediaQuery(BESIDE);
		render({ showNav: false, fills: true });
		expect(sidebar()).toBeNull();
	});
});

// DESIGN.md § Layout: the wall between a dock and the graph is the reader's to
// move, and the column at the other edge strikes the same bargain.
describe("the column's wall", () => {
	const wall = () => target.querySelector<HTMLElement>('aside [role="separator"]');

	function pointer(type: string, clientX: number): PointerEvent {
		const event = new Event(type, { bubbles: true, cancelable: true });
		Object.assign(event, { pointerId: 1, pointerType: 'mouse', button: 0, clientX, clientY: 300 });
		return event as PointerEvent;
	}

	const press = (key: string): KeyboardEvent =>
		new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

	beforeEach(() => {
		viewport = stubMediaQuery(BESIDE);
	});

	it('shows a grip at rest, in a target a finger can hit', () => {
		render();
		expect(wall()?.getAttribute('aria-orientation')).toBe('vertical');
		expect(wall()?.getAttribute('aria-label')).toBe('How much room this column takes');
		expect(wall()?.className).toContain('w-6');
		expect(wall()?.querySelector('span')?.className).toContain('bg-border');
	});

	it('comes last, so the destinations reach a keyboard reader first', () => {
		render();
		const reachable = [
			...(sidebar()?.querySelectorAll<HTMLElement>('a, button, [tabindex="0"]') ?? [])
		];
		expect(reachable.at(-1)).toBe(wall());
	});

	// A narrowed column is an icon rail at one width, and the toggle is the way
	// back: two ways to the same state is how a reader loses a column by
	// accident.
	it('is not drawn on the icon rail', () => {
		render({ deskNavOpen: false });
		expect(wall()?.hidden).toBe(true);
	});

	it('opens at the width the stylesheet names until this reader has taken one', () => {
		render();
		expect(sidebar()?.className).toContain('w-(--desk-nav-width)');
		expect(clearsTheColumn()).toBe('256px');
	});

	it('stands at the width this reader took, and owes it', () => {
		render({ deskNavWidth: 320 });
		expect(sidebar()?.style.width).toBe('320px');
		expect(clearsTheColumn()).toBe('320px');
	});

	it('owes every width the drag passes through, not only the last', () => {
		render({ deskNavWidth: 320 });
		wall()?.dispatchEvent(pointer('pointerdown', 320));
		wall()?.dispatchEvent(pointer('pointermove', 360));
		flushSync();
		expect(clearsTheColumn()).toBe('360px');
		expect(chromeInset.start).toBe(360);
	});

	it('keeps the width the drag settled on', () => {
		const asked: number[] = [];
		render({ deskNavWidth: 320, onDeskNavWidthChange: (px: number) => asked.push(px) });
		wall()?.dispatchEvent(pointer('pointerdown', 320));
		wall()?.dispatchEvent(pointer('pointermove', 360));
		wall()?.dispatchEvent(pointer('pointerup', 360));
		flushSync();
		expect(asked).toEqual([360]);
	});

	it('keeps nothing from a press on the wall that never moved', () => {
		const asked: number[] = [];
		render({ deskNavWidth: 320, onDeskNavWidthChange: (px: number) => asked.push(px) });
		wall()?.dispatchEvent(pointer('pointerdown', 320));
		wall()?.dispatchEvent(pointer('pointerup', 320));
		flushSync();
		expect(asked).toEqual([]);
	});

	// A wall only a mouse can move is a desktop-only affordance.
	it('moves by the arrow keys, the way a separator does', () => {
		const asked: number[] = [];
		render({ deskNavWidth: 320, onDeskNavWidthChange: (px: number) => asked.push(px) });
		wall()?.dispatchEvent(press('ArrowRight'));
		flushSync();
		expect(clearsTheColumn()).toBe('344px');

		wall()?.dispatchEvent(press('ArrowLeft'));
		flushSync();
		expect(asked).toEqual([344, 320]);
	});

	it('will not squeeze the column below the words its destinations read in', () => {
		render({ deskNavWidth: 40 });
		expect(clearsTheColumn()).toBe('224px');
		expect(wall()?.getAttribute('aria-valuemin')).toBe('224');
	});

	it('stops where the column’s own parts stop widening', () => {
		render({ deskNavWidth: 10_000 });
		expect(clearsTheColumn()).toBe('448px');
		expect(wall()?.getAttribute('aria-valuemax')).toBe('448');
	});

	// Each is bounded against what the window has left once the other has taken
	// its room, so a column and a dock cannot between them leave no graph.
	it('answers a saved width against the room the docks have taken', () => {
		const place = docksRight(0);
		place.takes(400);
		try {
			render({ deskNavWidth: 400 });
			expect(clearsTheColumn()).toBe('224px');
			expect(wall()?.getAttribute('aria-valuemax')).toBe('224');
		} finally {
			place.leaves();
		}
	});
});

describe('what an open column may take', () => {
	it('leaves the graph its own room, however little window there is', () => {
		expect(columnWithin(1024).most).toBe(448);
		expect(columnWithin(800).most).toBe(352);
		expect(columnWithin(600).most).toBe(columnWithin(600).least);
	});

	it('holds a width inside those bounds at both ends', () => {
		expect(columnWidth(10_000, 1920)).toBe(448);
		expect(columnWidth(10, 1920)).toBe(224);
		expect(columnWidth(320.4, 1920)).toBe(320);
	});
});
