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
	it('keeps the only folder open: no close, and Delete does nothing', () => {
		render({ tabs: [{ root: GARDEN, name: 'The garden', active: true }] });

		expect(folders().map((one) => one.textContent)).toEqual(['The garden']);
		expect(named('Close The garden')).toBeNull();
		expect(named('Open another')).not.toBeNull();
		folders()[0]?.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })
		);
		expect(closed).toEqual([]);
	});

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

		named('Open another')?.click();
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

	// One stop on the way in, and it is the folder the keyboard was last on:
	// walking the strip has to leave somebody where they left off.
	it('carries the one stop the keyboard has along with the focus', () => {
		render();
		expect(folders().map((one) => one.getAttribute('tabindex'))).toEqual(['-1', '0']);

		folders()[1].focus();
		folders()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
		flushSync();

		expect(folders().map((one) => one.getAttribute('tabindex'))).toEqual(['0', '-1']);
	});

	// The close control is inside the folder it closes, so the keyboard closes
	// one where it already stands rather than tabbing into each of them.
	it('closes the folder the keyboard is on, and never stops at its own control', () => {
		render();
		expect(named('Close The garden')?.getAttribute('tabindex')).toBe('-1');

		folders()[0].focus();
		folders()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
		flushSync();

		expect(closed).toEqual([GARDEN]);
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

		for (const one of [...folders(), named('Close The garden'), named('Open another')]) {
			expect(one?.className).toContain('min-h-control');
		}
		expect(named('Close The garden')?.className).toContain('min-w-control');
		expect(named('Open another')?.className).toContain('min-w-control');
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
