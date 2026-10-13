// @vitest-environment jsdom
// Where the bar stands when something else has taken room beside the graph.

import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { stubResizeObserver } from '../dom.test-support.js';
import ChosenBar from './chosen-bar.svelte';

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let built: number;

const bar = () => target.firstElementChild as HTMLElement;

const acts = (): string[] =>
	[...target.querySelectorAll('button')].map((one) => one.textContent?.trim() ?? '');

function show(props: Record<string, unknown>): void {
	if (mounted) unmount(mounted, { outro: false });
	mounted = mount(ChosenBar, {
		target,
		props: {
			count: 2,
			onTags: () => undefined,
			onLook: () => undefined,
			onDelete: () => undefined,
			onDone: () => undefined,
			...props
		}
	});
	flushSync();
}

beforeEach(() => {
	stubResizeObserver();
	built = 0;
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

// DESIGN.md § "A build": Build these stands on the bar of a chosen set, and
// nowhere a build is not offered.
it('offers building the chosen notes where a build is offered', () => {
	show({ onBuild: () => (built += 1) });

	expect(acts()).toContain('Build these');

	const row = [...target.querySelectorAll('button')].find(
		(one) => one.textContent?.trim() === 'Build these'
	);
	(row as HTMLButtonElement).click();
	flushSync();
	expect(built).toBe(1);
});

it('offers nothing to build where a build is not offered', () => {
	show({});

	expect(acts()).not.toContain('Build these');
});
