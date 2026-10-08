// The schemes a person can dress the app in — DESIGN.md § Schemes. What a
// dressing resolves to is `@sloppy/ui`'s to answer for; this is the surface
// that offers them, and what picking one leaves on `<html>`.

import { schemes } from '@sloppy/ui';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prefs } from '../stores/prefs.svelte.js';
import SchemePicker from './scheme-picker.svelte';

/** A scheme the collection carries, legible, with an author nothing else has. */
const NORD = { slug: 'base16-nord', name: 'Nord', author: 'arcticicestudio' };
/** One the picker leaves out: its own ink does not read on its own page. */
const CUPCAKE = 'Cupcake';

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

function rows(): HTMLButtonElement[] {
	return [...target.querySelectorAll('button')];
}

/** What a row calls its scheme — the name beside the colours, not the author. */
function nameOf(row: HTMLButtonElement): string {
	const name = row.querySelector(':scope > span:not([aria-hidden])');
	return (name ?? row).textContent?.trim() ?? '';
}

function named(): string[] {
	return rows().map(nameOf);
}

function press(name: string): void {
	const row = rows().find((one) => nameOf(one) === name);
	if (!row) throw new Error(`No "${name}" to pick`);
	row.click();
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
		.filter((row) => row.getAttribute('aria-pressed') === 'true')
		.map(nameOf);
}

beforeEach(async () => {
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
	it('stands the theme down to None, and leads with it', async () => {
		show();
		await settle();

		expect(named()[0]).toBe('None');
		expect(chosen()).toEqual(['None']);
	});

	it('offers the collection, each one its own sixteen colours', async () => {
		show();
		await settle();

		expect(rows().length).toBeGreaterThan(400);
		find(NORD.name);
		const swatches = [...rows()[1].querySelectorAll<HTMLElement>('span[style]')];
		expect(swatches).toHaveLength(16);

		const nord = (await schemes()).find((one) => one.slug === NORD.slug);
		const asPainted = document.createElement('span');
		asPainted.style.backgroundColor = nord?.palette.base00 ?? '';
		expect(swatches[0].style.backgroundColor).toBe(asPainted.style.backgroundColor);
	});

	it('leaves out what it cannot dress the app in', async () => {
		show();
		await settle();

		find(CUPCAKE);
		expect(named()).not.toContain(CUPCAKE);
		expect(document.body.textContent).toContain('Nothing here is called that.');
	});
});

describe('finding one', () => {
	it('is by name', async () => {
		show();
		await settle();

		find('nord');
		expect(named()).toContain(NORD.name);
		expect(rows().length).toBeLessThan(20);
	});

	it('is by whoever wrote it', async () => {
		show();
		await settle();

		find(NORD.author);
		expect(named()).toContain(NORD.name);
	});

	it('is every one of them again once nothing is asked', async () => {
		show();
		await settle();

		find(NORD.name);
		const some = rows().length;
		find('');
		expect(rows().length).toBeGreaterThan(some);
	});
});

describe('picking one', () => {
	it('dresses the app in it, and says so where the canvas is watching', async () => {
		show();
		await settle();

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

	it('hands the app back to the theme at None', async () => {
		show();
		await settle();

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
	});
});
