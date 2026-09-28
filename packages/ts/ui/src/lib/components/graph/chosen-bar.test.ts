// @vitest-environment jsdom
// Where the bar stands when something else has taken room beside the graph.

import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { stubResizeObserver } from '../dom.test-support.js';
import ChosenBar from './chosen-bar.svelte';

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

const bar = () => target.firstElementChild as HTMLElement;

beforeEach(() => {
	stubResizeObserver();
	target = document.createElement('div');
	document.body.appendChild(target);
	mounted = mount(ChosenBar, {
		target,
		props: {
			count: 2,
			onTags: () => undefined,
			onLook: () => undefined,
			onDelete: () => undefined,
			onDone: () => undefined
		}
	});
	flushSync();
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.documentElement.style.removeProperty('--chosen-bar-inset-bottom');
});

// DESIGN.md § "The four inset vars": a layer pinned across the page starts
// where the chrome beside the graph leaves off and ends where the docks begin.
it('stands between the chrome beside the graph and whatever is docked', () => {
	const style = bar().style;

	expect(style.getPropertyValue('inset-inline-start')).toBe('var(--app-chrome-inset-start, 0px)');
	expect(style.getPropertyValue('right')).toBe('var(--reading-dock-inset-right, 0px)');
});
