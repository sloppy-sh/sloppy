// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubResizeObserver } from './dom.test-support.js';
import TabStrip from './tab-strip.svelte';

const GARDEN = '/Users/me/garden';
const THESIS = '/Users/me/thesis';

/** What jsdom lays out as nothing: the strip is as tall as a control and the
 *  system inset it clears. */
const STRIP_PX = 48;

const switched: string[] = [];
const closed: string[] = [];
let opened = 0;

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

function render(props: Record<string, unknown> = {}) {
	mounted = mount(TabStrip, {
		target,
		props: {
			tabs: [
				{ root: GARDEN, name: 'The garden', active: false },
				{ root: THESIS, name: 'The thesis', active: true }
			],
			onSwitch: (root: string) => switched.push(root),
			onClose: (root: string) => closed.push(root),
			onOpen: () => opened++,
			...props
		}
	});
	flushSync();
}

const row = () => target.querySelector('[role="tablist"]');
const folders = () => [...target.querySelectorAll<HTMLElement>('[role="tab"]')];
const named = (label: string) => target.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
const clearsTheStrip = () => document.documentElement.style.getPropertyValue('--app-chrome-top');

beforeEach(() => {
	stubResizeObserver();
	Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
		configurable: true,
		get: () => STRIP_PX
	});
	switched.length = 0;
	closed.length = 0;
	opened = 0;
	target = document.createElement('div');
	document.body.append(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.documentElement.style.removeProperty('--app-chrome-top');
});

describe('the strip of folders open', () => {
	it('stands one folder beside another, named as the graphs in them', () => {
		render();

		expect(row()?.getAttribute('aria-label')).toBe('Folders open');
		expect(folders().map((one) => one.textContent?.trim())).toEqual(['The garden', 'The thesis']);
	});

	it('says which of them is the one in front', () => {
		render();

		expect(folders().map((one) => one.getAttribute('aria-selected'))).toEqual(['false', 'true']);
	});

	// The whole path, for two folders a person has called the same thing.
	it('says where each folder is', () => {
		render();

		expect(folders().map((one) => one.getAttribute('title'))).toEqual([GARDEN, THESIS]);
	});

	it('puts the folder tapped in front, by where it is', () => {
		render();

		folders()[0].click();
		flushSync();

		expect(switched).toEqual([GARDEN]);
	});

	it('closes the folder whose own control is tapped', () => {
		render();

		named('Close The garden')?.click();
		flushSync();

		expect(closed).toEqual([GARDEN]);
		expect(switched).toEqual([]);
	});

	it('opens another folder from the one control for it', () => {
		render();

		named('Open a folder')?.click();
		flushSync();

		expect(opened).toBe(1);
	});

	it('walks the folders with the arrow keys, leaving the one in front where it is', () => {
		render();
		folders()[1].focus();

		folders()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
		flushSync();

		expect(document.activeElement).toBe(folders()[0]);
		expect(switched).toEqual([]);
	});

	it('walks past the last of them back to the first', () => {
		render();
		folders()[1].focus();

		folders()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		flushSync();

		expect(document.activeElement).toBe(folders()[0]);
	});

	// DESIGN.md § "The four inset vars": the full height, the system inset it
	// clears included, so everything below it stands clear of both.
	it('owes its whole height, and owes nothing once it has gone', () => {
		render();
		expect(clearsTheStrip()).toBe(`${STRIP_PX}px`);

		unmount(mounted!, { outro: false });
		mounted = undefined;

		expect(clearsTheStrip()).toBe('');
	});

	it('gives every folder and every control a target a finger can hit', () => {
		render();

		for (const one of [...folders(), named('Close The garden'), named('Open a folder')]) {
			expect(one?.className).toContain('min-h-control');
		}
		expect(named('Close The garden')?.className).toContain('min-w-control');
		expect(named('Open a folder')?.className).toContain('min-w-control');
	});

	it('says what did not happen in the words it was handed', () => {
		render({ refused: 'Keep at least one folder open.' });

		expect(target.querySelector('[role="alert"]')?.textContent).toBe(
			'Keep at least one folder open.'
		);
	});

	it('says nothing where nothing was refused', () => {
		render();

		expect(target.querySelector('[role="alert"]')).toBeNull();
	});
});
