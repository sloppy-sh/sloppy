// The schemes a person can dress the app in — DESIGN.md § Schemes. What a
// dressing resolves to is `@sloppy/ui`'s to answer for; this is the surface
// that offers them, and what picking one leaves on `<html>`.

import { schemes } from '@sloppy/ui';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prefs } from '../stores/prefs.svelte.js';
import SchemePicker from './scheme-picker.svelte';

/** Whether the collection is unreachable for the test about to run. */
let broken = false;

vi.mock('@sloppy/ui', async (original) => {
	const real = await original<typeof import('@sloppy/ui')>();
	return {
		...real,
		schemes: () => (broken ? Promise.reject(new Error('nothing to read')) : real.schemes())
	};
});

/** A scheme the collection carries, legible, with an author nothing else has. */
const NORD = { slug: 'base16-nord', name: 'Nord', author: 'arcticicestudio' };
/** One the picker leaves out: its own ink does not read on its own page. */
const CUPCAKE = 'Cupcake';
/** How many rows stand at once, which `scheme-picker.svelte` caps. */
const MOST = 60;

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

function show(): void {
	mounted = mount(SchemePicker, { target });
	flushSync();
}

/** The collection arrives through a dynamic import, and every row with it. */
async function settle(): Promise<void> {
	for (let turn = 0; turn < 8; turn += 1) await new Promise((done) => setTimeout(done, 0));
	flushSync();
}

function disclosure(): HTMLButtonElement {
	const found = target.querySelector<HTMLButtonElement>('button[aria-expanded]');
	if (!found) throw new Error('Nothing to open the schemes with');
	return found;
}

async function openUp(): Promise<void> {
	disclosure().click();
	flushSync();
	await settle();
}

function rows(): HTMLButtonElement[] {
	return [...target.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
}

/** What a row calls its scheme — the name beside the colours, not the author. */
function nameOf(row: HTMLElement): string {
	const holder = row.querySelector(':scope > span:not([aria-hidden])');
	const first = holder?.querySelector('span');
	return (first ?? holder ?? row).textContent?.trim() ?? '';
}

function named(): string[] {
	return rows().map(nameOf);
}

function rowFor(name: string): HTMLButtonElement {
	const row = rows().find((one) => nameOf(one) === name);
	if (!row) throw new Error(`No "${name}" to pick`);
	return row;
}

function press(name: string): void {
	rowFor(name).click();
	flushSync();
}

function find(said: string): void {
	const field = target.querySelector<HTMLInputElement>('input[type="search"]');
	if (!field) throw new Error('Nowhere to type');
	field.value = said;
	field.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

function chosen(): string[] {
	return rows()
		.filter((row) => row.getAttribute('aria-checked') === 'true')
		.map(nameOf);
}

function group(): HTMLElement {
	const found = target.querySelector<HTMLElement>('[role="radiogroup"]');
	if (!found) throw new Error('The rows are not one group');
	return found;
}

/** A key pressed where the keyboard stands in the group. */
function type(key: string): void {
	const at = rows().find((row) => row.tabIndex === 0) ?? rows()[0];
	at.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
	flushSync();
}

beforeEach(async () => {
	broken = false;
	// The collection is read once per session, so warming it here is what makes
	// the first mount settle in as few turns as every later one.
	await schemes();
	Object.defineProperty(globalThis, 'ResizeObserver', {
		configurable: true,
		writable: true,
		value: class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	});
	localStorage.clear();
	prefs.init();
	target = document.createElement('div');
	document.body.append(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	prefs.setScheme(null);
	target.remove();
	localStorage.clear();
});

describe('the schemes on offer', () => {
	it('stands closed, saying what is on and nothing else', async () => {
		show();
		await settle();

		expect(rows()).toHaveLength(0);
		expect(target.querySelector('input[type="search"]')).toBeNull();
		expect(disclosure().getAttribute('aria-label')).toBe('Scheme: None');
	});

	it('leads with None once it is opened, and caps what stands at once', async () => {
		show();
		await settle();
		await openUp();

		expect(named()[0]).toBe('None');
		expect(chosen()).toEqual(['None']);
		expect(rows()).toHaveLength(MOST + 1);
		expect(target.textContent).toContain('more — keep typing');
	});

	it('offers each one its own sixteen colours, in a strip that cannot grow', async () => {
		show();
		await settle();
		await openUp();

		find(NORD.name);
		const strip = rowFor(NORD.name).querySelector<HTMLElement>('span[aria-hidden]');
		const swatches = [...(strip?.querySelectorAll<HTMLElement>('span[style]') ?? [])];
		expect(swatches).toHaveLength(16);
		// jsdom lays nothing out, so what the row is held to is the bound itself:
		// a strip of its own width that clips, beside a name that may shrink.
		expect(strip?.className).toContain('w-32');
		expect(strip?.className).toContain('shrink-0');
		expect(strip?.className).toContain('overflow-hidden');

		const nord = (await schemes()).find((one) => one.slug === NORD.slug);
		const asPainted = document.createElement('span');
		asPainted.style.backgroundColor = nord?.palette.base00 ?? '';
		expect(swatches[0].style.backgroundColor).toBe(asPainted.style.backgroundColor);
	});

	it('bounds every row inside the section, so the page scrolls one way', async () => {
		show();
		await settle();
		await openUp();

		const fieldset = target.querySelector('fieldset');
		expect(fieldset?.className).toContain('min-w-0');
		find(NORD.name);
		const row = rowFor(NORD.name);
		expect(row.className).toContain('w-full');
		const holder = row.querySelector<HTMLElement>(':scope > span:not([aria-hidden])');
		expect(holder?.className).toContain('min-w-0');
		expect(holder?.className).toContain('flex-1');
		expect(group().className).toContain('overflow-y-auto');
	});

	it('leaves out what it cannot dress the app in', async () => {
		show();
		await settle();
		await openUp();

		find(CUPCAKE);
		expect(named()).not.toContain(CUPCAKE);
		expect(target.textContent).toContain(
			'Nothing here is called that, or it would not be readable.'
		);
	});

	it('says so where the collection cannot be read at all', async () => {
		broken = true;
		show();
		await settle();
		await openUp();

		expect(target.textContent).toContain('The schemes could not be loaded. Try again later.');
		expect(target.querySelector('input[type="search"]')).toBeNull();
		expect(rows()).toHaveLength(0);
	});
});

describe('finding one', () => {
	beforeEach(async () => {
		show();
		await settle();
		await openUp();
	});

	it('is by name', () => {
		find('nord');
		expect(named()).toContain(NORD.name);
		expect(rows().length).toBeLessThan(20);
	});

	it('is by whoever wrote it', () => {
		find(NORD.author);
		expect(named()).toContain(NORD.name);
	});

	it('is every one of them again once nothing is asked', () => {
		find(NORD.name);
		const some = rows().length;
		find('');
		expect(rows().length).toBeGreaterThan(some);
	});

	it('keeps the one being worn on screen, however many others match', () => {
		find(NORD.name);
		press(NORD.name);
		find('');

		expect(rows()).toHaveLength(MOST + 1);
		expect(named()).toContain(NORD.name);
		expect(chosen()).toEqual([NORD.name]);
	});
});

describe('picking one', () => {
	it('dresses the app in it, and says so where the canvas is watching', async () => {
		show();
		await settle();
		await openUp();

		find(NORD.name);
		press(NORD.name);

		expect(prefs.current.scheme).toBe(NORD.slug);
		expect(prefs.dressing?.variant).toBe('dark');
		const root = document.documentElement;
		expect(root.getAttribute('data-theme')).toBe('scheme');
		expect(root.getAttribute('data-scheme')).toBe(NORD.slug);
		expect(root.style.getPropertyValue('--background')).toMatch(/^#[0-9a-f]{6}$/);
		expect(chosen()).toEqual([NORD.name]);
	});

	it('is what the closed row says afterwards', async () => {
		show();
		await settle();
		await openUp();

		find(NORD.name);
		press(NORD.name);
		disclosure().click();
		flushSync();

		expect(disclosure().getAttribute('aria-label')).toBe(`Scheme: ${NORD.name}`);
		expect(rows()).toHaveLength(0);
		expect(disclosure().querySelector('span[aria-hidden] span[style]')).not.toBeNull();
	});

	it('hands the app back to the theme at None', async () => {
		show();
		await settle();
		await openUp();

		find(NORD.name);
		press(NORD.name);
		press('None');

		expect(prefs.current.scheme).toBeNull();
		expect(prefs.dressing).toBeNull();
		expect(document.documentElement.getAttribute('data-scheme')).toBeNull();
		expect(document.documentElement.getAttribute('data-theme')).toBe(prefs.current.theme);
		expect(document.documentElement.style.getPropertyValue('--background')).toBe('');
	});

	it('leaves the other axes as the person set them', async () => {
		prefs.set('accent', 'moss');
		prefs.set('style', 'hardline');
		show();
		await settle();
		await openUp();

		find(NORD.name);
		press(NORD.name);

		const root = document.documentElement;
		expect(root.getAttribute('data-accent')).toBe('moss');
		expect(root.getAttribute('data-style')).toBe('hardline');
		expect(root.style.getPropertyValue('--primary')).toBe('');
	});

	// A look saved on a device that kept the slug and not the paint: the
	// collection is what resolves one, and it is read here.
	it('dresses the app again from a slug with no paint beside it', async () => {
		localStorage.setItem('sloppy_prefs', JSON.stringify({ scheme: NORD.slug }));
		prefs.init();
		expect(prefs.dressing).toBeNull();

		show();
		await settle();

		expect(prefs.dressing?.slug).toBe(NORD.slug);
		expect(document.documentElement.getAttribute('data-scheme')).toBe(NORD.slug);
		expect(disclosure().getAttribute('aria-label')).toBe(`Scheme: ${NORD.name}`);
	});

	it('stands down a saved look this collection has nothing for', async () => {
		localStorage.setItem('sloppy_prefs', JSON.stringify({ scheme: 'nothing-is-called-this' }));
		prefs.init();
		expect(prefs.current.scheme).toBe('nothing-is-called-this');

		show();
		await settle();

		expect(prefs.current.scheme).toBeNull();
		expect(document.documentElement.getAttribute('data-theme')).toBe(prefs.current.theme);
		expect(disclosure().getAttribute('aria-label')).toBe('Scheme: None');
	});

	it('keeps a saved look where the collection could not be read', async () => {
		broken = true;
		localStorage.setItem('sloppy_prefs', JSON.stringify({ scheme: NORD.slug }));
		prefs.init();

		show();
		await settle();

		expect(prefs.current.scheme).toBe(NORD.slug);
	});
});

describe('the rows as one group', () => {
	beforeEach(async () => {
		show();
		await settle();
		await openUp();
		find(NORD.name);
	});

	it('is one tab stop, wherever the keyboard stands in it', () => {
		expect(rows().filter((row) => row.tabIndex === 0)).toHaveLength(1);
		expect(rows()[0].tabIndex).toBe(0);

		type('ArrowDown');
		const stops = rows().filter((row) => row.tabIndex === 0);
		expect(stops).toHaveLength(1);
		expect(nameOf(stops[0])).toBe(nameOf(rows()[1]));
		expect(document.activeElement).toBe(rows()[1]);
	});

	it('picks what the keyboard stands on', () => {
		const first = nameOf(rows()[1]);
		type('ArrowDown');
		type('Enter');
		expect(chosen()).toEqual([first]);
		expect(prefs.dressing).not.toBeNull();

		type('Home');
		type(' ');
		expect(prefs.current.scheme).toBeNull();
		expect(chosen()).toEqual(['None']);
	});

	it('stays inside itself at either end', () => {
		type('ArrowUp');
		expect(rows()[0].tabIndex).toBe(0);

		type('End');
		const last = rows()[rows().length - 1];
		expect(last.tabIndex).toBe(0);
		type('ArrowDown');
		expect(last.tabIndex).toBe(0);
	});
});
