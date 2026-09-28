// @vitest-environment jsdom
import HouseIcon from '@lucide/svelte/icons/house';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Harness from './app-shell-harness.test.svelte';
import { DESK_FROM_PX } from './desk-nav.svelte.js';
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
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.documentElement.style.removeProperty('--sysnav-inset-bottom');
});

/** The floating pill is the nav that stands outside the sidebar. */
const pill = () => [...target.querySelectorAll('nav')].find((nav) => !nav.closest('aside')) ?? null;
const sidebar = () => target.querySelector('aside');
const clearsThePill = () =>
	document.documentElement.style.getPropertyValue('--sysnav-inset-bottom');

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
