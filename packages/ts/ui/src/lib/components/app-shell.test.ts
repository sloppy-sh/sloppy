// @vitest-environment jsdom
import HouseIcon from '@lucide/svelte/icons/house';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Harness from './app-shell-harness.test.svelte';
import { stubResizeObserver } from './dom.test-support.js';
import { overlay } from './overlay.svelte.js';

const ITEMS = [{ id: 'graph', label: 'Graph', href: '/', icon: HouseIcon }];

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let mounts = 0;

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
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
});

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
