// The looks a person can dress the app in — DESIGN.md § "The look". What a look
// carried as data resolves to is `@sloppy/ui`'s to answer for; this is the
// surface that offers all of them in one list, and what picking one leaves on
// `<html>`.

import { dressed, schemes } from '@sloppy/ui';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILT_IN_LOOKS, LOOK_LABELS, prefs } from '../stores/prefs.svelte.js';
import LookPicker from './look-picker.svelte';

/** Whether the collection is unreachable for the test about to run. */
let broken = false;

vi.mock('@sloppy/ui', async (original) => {
	const real = await original<typeof import('@sloppy/ui')>();
	return {
		...real,
		schemes: () => (broken ? Promise.reject(new Error('nothing to read')) : real.schemes())
	};
});

/** A look the collection carries, legible, with an author nothing else has. */
const NORD = { slug: 'base16-nord', name: 'Nord', author: 'arcticicestudio' };
/** One the picker leaves out: its own ink does not read on its own page. */
const CUPCAKE = 'Cupcake';
/** The four a dressing carried none of until a look became the whole palette,
 *  which is what an upgrading device has cached. */
const ACCENT_FAMILY = ['--primary', '--primary-foreground', '--primary-mark', '--ring'] as const;
/** How many of the collection's rows stand at once, which `look-picker.svelte`
 *  caps. */
const MOST = 60;
/** Sloppy's own, which stand whether the collection has been read or not. */
const OWN = BUILT_IN_LOOKS.length;

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

function show(): void {
	mounted = mount(LookPicker, { target });
	flushSync();
}

/** The collection arrives through a dynamic import, and every row with it. */
async function settle(): Promise<void> {
	for (let turn = 0; turn < 8; turn += 1) await new Promise((done) => setTimeout(done, 0));
	flushSync();
}

function disclosure(): HTMLButtonElement {
	const found = target.querySelector<HTMLButtonElement>('button[aria-expanded]');
	if (!found) throw new Error('Nothing to open the collection with');
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

/** What a row calls its look — the name beside the colours, not the author. */
function nameOf(row: HTMLElement): string {
	const holder = row.querySelector(':scope > span:not([aria-hidden])');
	const first = holder?.querySelector('span');
	return (first ?? holder ?? row).textContent?.trim() ?? '';
}

function named(): string[] {
	return rows().map(nameOf);
}

/** A colour as the DOM serialises it, so a swatch and whatever declared it are
 *  compared the same way however each of the two was written. */
function asPainted(colour: string): string {
	const probe = document.createElement('span');
	probe.style.backgroundColor = colour;
	return probe.style.backgroundColor;
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
	prefs.setLook(null, 'paper');
	target.remove();
	localStorage.clear();
});

describe('the looks on offer', () => {
	it("stands closed on Sloppy's own, with the collection behind one control", async () => {
		show();
		await settle();

		expect(named()).toEqual(BUILT_IN_LOOKS.map((look) => LOOK_LABELS[look]));
		expect(chosen()).toEqual(['Paper']);
		expect(target.querySelector('input[type="search"]')).toBeNull();
		expect(disclosure().textContent?.trim()).toBe('More looks');
	});

	// A control that opens something says so, and says what — and a reader meets
	// it before the rows it adds to.
	it('says what it opens, and stands before it', async () => {
		show();
		await settle();

		expect(disclosure().getAttribute('aria-expanded')).toBe('false');
		expect(disclosure().getAttribute('aria-controls')).toBe(group().id);
		expect(group().id).not.toBe('');
		expect(disclosure().compareDocumentPosition(group())).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

		await openUp();
		expect(disclosure().getAttribute('aria-expanded')).toBe('true');
	});

	it("leads with Sloppy's own once it is opened, and caps what stands at once", async () => {
		show();
		await settle();
		await openUp();

		expect(named().slice(0, OWN)).toEqual(BUILT_IN_LOOKS.map((look) => LOOK_LABELS[look]));
		expect(rows()).toHaveLength(OWN + MOST);
		expect(target.textContent).toContain('more — keep typing');
	});

	it('offers each of the collection its own sixteen colours, in a strip that cannot grow', async () => {
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
		expect(swatches[0].style.backgroundColor).toBe(asPainted(nord?.palette.base00 ?? ''));
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

	it("says so where the collection cannot be read, and still offers Sloppy's own", async () => {
		broken = true;
		show();
		await settle();
		await openUp();

		expect(target.textContent).toContain('The looks could not be loaded. Try again later.');
		expect(target.querySelector('input[type="search"]')).toBeNull();
		expect(rows()).toHaveLength(OWN);
	});
});

// A look block in `app.css` only ever applies to `<html>`, so the five strips
// are a table in the component — and a table beside the stylesheet is a copy
// that drifts unless something holds the two together.
describe("the strip on each of Sloppy's own", () => {
	const CSS = readFileSync(resolve(process.cwd(), '../ui/src/lib/app.css'), 'utf8').replace(
		/\/\*[\s\S]*?\*\//g,
		''
	);
	/** What each strip shows, in the order it shows them: the page, a quiet
	 *  surface on it, the accent and the ink. */
	const SHOWN = ['--background', '--muted', '--primary', '--foreground'];

	/** What `app.css` declares for one of Sloppy's own looks, token by token. */
	function declared(look: string): Map<string, string> {
		for (const [, selectors, body] of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
			if (!selectors.includes(`:root[data-look='${look}']`)) continue;
			const out = new Map<string, string>();
			for (const line of body.split(';')) {
				const colon = line.indexOf(':');
				if (colon < 0) continue;
				const name = line.slice(0, colon).trim();
				if (name.startsWith('--')) out.set(name, line.slice(colon + 1).trim());
			}
			if (out.has('--background')) return out;
		}
		throw new Error(`app.css declares no look called ${look}`);
	}

	it.each(BUILT_IN_LOOKS)('is what app.css declares for %s', async (look) => {
		show();
		await settle();

		const strip = rowFor(LOOK_LABELS[look]).querySelector<HTMLElement>('span[aria-hidden]');
		const swatches = [...(strip?.querySelectorAll<HTMLElement>('span[style]') ?? [])];
		const block = declared(look);
		expect(swatches).toHaveLength(SHOWN.length);
		for (const [at, token] of SHOWN.entries()) {
			expect(swatches[at].style.backgroundColor, `${look} ${token}`).toBe(
				asPainted(block.get(token) ?? '')
			);
		}
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
		expect(rows().length).toBeLessThan(20 + OWN);
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

		expect(rows()).toHaveLength(OWN + MOST);
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

		expect(prefs.current.look).toBe(NORD.slug);
		expect(prefs.dressing?.variant).toBe('dark');
		const root = document.documentElement;
		expect(root.getAttribute('data-look')).toBe(NORD.slug);
		expect(root.classList.contains('dark')).toBe(true);
		expect(root.style.getPropertyValue('--background')).toMatch(/^#[0-9a-f]{6}$/);
		expect(chosen()).toEqual([NORD.name]);
	});

	// The whole palette, the accent included — DESIGN.md § "The look".
	it('takes the accent from the look itself', async () => {
		show();
		await settle();
		await openUp();

		find(NORD.name);
		press(NORD.name);

		const root = document.documentElement;
		for (const token of ['--primary', '--primary-foreground', '--primary-mark', '--ring']) {
			expect(root.style.getPropertyValue(token), token).toMatch(/^#[0-9a-f]{6}$/);
		}
	});

	// `data-look` is the one attribute the canvas watches for a change of palette,
	// so two looks carried as data have to differ in it and not only in the paint
	// beside it — DESIGN.md § "A look carried as data".
	it('says which one, so a move between two of them reaches the canvas', async () => {
		show();
		await settle();
		await openUp();

		const root = document.documentElement;
		rows()[OWN].click();
		flushSync();
		const first = root.getAttribute('data-look');
		expect(first).toBe(prefs.current.look);

		rows()[OWN + 1].click();
		flushSync();
		expect(root.getAttribute('data-look')).toBe(prefs.current.look);
		expect(root.getAttribute('data-look')).not.toBe(first);
	});

	// Closed, the group still has to say what is on: the rest of the collection
	// goes away and the look being worn stands with Sloppy's own five.
	it('stands in the group afterwards, closed, as the one that is on', async () => {
		show();
		await settle();
		await openUp();

		find(NORD.name);
		press(NORD.name);
		disclosure().click();
		flushSync();

		expect(rows()).toHaveLength(OWN + 1);
		expect(chosen()).toEqual([NORD.name]);
		expect(rowFor(NORD.name).querySelectorAll('span[aria-hidden] span[style]')).toHaveLength(16);
	});

	it("hands the app back to one of Sloppy's own", async () => {
		show();
		await settle();
		await openUp();

		find(NORD.name);
		press(NORD.name);
		press(LOOK_LABELS.graphite);

		expect(prefs.current.look).toBe('graphite');
		expect(prefs.dressing).toBeNull();
		expect(document.documentElement.getAttribute('data-look')).toBe('graphite');
		expect(document.documentElement.style.getPropertyValue('--background')).toBe('');
		expect(document.documentElement.style.getPropertyValue('--primary')).toBe('');
	});

	it('leaves the other axes as the person set them', async () => {
		prefs.set('style', 'hardline');
		prefs.set('density', 'compact');
		show();
		await settle();
		await openUp();

		find(NORD.name);
		press(NORD.name);

		const root = document.documentElement;
		expect(root.getAttribute('data-style')).toBe('hardline');
		expect(root.getAttribute('data-density')).toBe('compact');
		expect(root.style.getPropertyValue('--border')).toBe('');
	});

	// A look saved on a device that kept the id and not the paint: the collection
	// is what resolves one, and it is read here.
	it('dresses the app again from an id with no paint beside it', async () => {
		localStorage.setItem('sloppy_prefs', JSON.stringify({ look: NORD.slug }));
		prefs.init();
		expect(prefs.dressing).toBeNull();

		show();
		await settle();

		expect(prefs.dressing?.slug).toBe(NORD.slug);
		expect(document.documentElement.getAttribute('data-look')).toBe(NORD.slug);
		expect(chosen()).toEqual([NORD.name]);
	});

	// Paint cached by a build whose dressing stopped short of the accent: it is
	// kept across a boot, so a look that is already on would wear the accent of
	// the stylesheet for good unless mounting the picker writes the whole palette.
	it('paints the accent over a copy cached without one', async () => {
		const nord = (await schemes()).find((one) => one.slug === NORD.slug);
		const full = nord === undefined ? null : dressed(nord);
		if (full === null) throw new Error(`The collection cannot dress ${NORD.name}`);
		const tokens: Record<string, string> = { ...full.tokens };
		for (const token of ACCENT_FAMILY) delete tokens[token];
		localStorage.setItem('sloppy_prefs', JSON.stringify({ scheme: NORD.slug }));
		localStorage.setItem(
			'sloppy_scheme',
			JSON.stringify({ slug: NORD.slug, variant: full.variant, tokens })
		);
		prefs.init();
		expect(prefs.current.look).toBe(NORD.slug);
		expect(document.documentElement.style.getPropertyValue('--primary')).toBe('');

		show();
		await settle();

		const root = document.documentElement;
		for (const token of ACCENT_FAMILY) {
			expect(root.style.getPropertyValue(token), token).toBe(full.tokens[token]);
		}
		expect(localStorage.getItem('sloppy_scheme')).toBeNull();
	});

	it('stands down a saved look this collection has nothing for', async () => {
		localStorage.setItem('sloppy_prefs', JSON.stringify({ look: 'nothing-is-called-this' }));
		prefs.init();
		expect(prefs.current.look).toBe('nothing-is-called-this');

		show();
		await settle();

		expect(prefs.current.look).toBe('paper');
		expect(document.documentElement.getAttribute('data-look')).toBe('paper');
		expect(chosen()).toEqual([LOOK_LABELS.paper]);
		expect(rows()).toHaveLength(OWN);
	});

	// The look it stood down from was painting a dark page, so the one it hands
	// the app to is dark too.
	it('stands one down onto the ground it was already standing on', async () => {
		localStorage.setItem('sloppy_prefs', JSON.stringify({ look: 'nothing-is-called-this' }));
		localStorage.setItem(
			'sloppy_look',
			JSON.stringify({
				slug: 'nothing-is-called-this',
				variant: 'dark',
				tokens: { '--background': '#101010' }
			})
		);
		prefs.init();
		expect(prefs.isDark).toBe(true);

		show();
		await settle();

		expect(prefs.current.look).toBe('graphite');
	});

	// A look somebody opened from a file of their own is worn under an id minted
	// past every look this Sloppy answers to, so the collection has nothing for it
	// by design — and standing it down would take it off them.
	it("leaves a look of somebody's own standing", async () => {
		localStorage.setItem(
			'sloppy_prefs',
			JSON.stringify({
				look: 'midnight-ink',
				ownLook: 'midnight-ink',
				lookName: 'Midnight Ink'
			})
		);
		localStorage.setItem(
			'sloppy_look',
			JSON.stringify({
				slug: 'midnight-ink',
				variant: 'dark',
				tokens: { '--background': '#101010' }
			})
		);
		prefs.init();

		show();
		await settle();

		expect(prefs.current.look).toBe('midnight-ink');
		expect(document.documentElement.getAttribute('data-look')).toBe('midnight-ink');
		expect(document.documentElement.style.getPropertyValue('--background')).toBe('#101010');
		// And it stands in the group under the name it arrived with, as the one
		// that is on — nothing else here would say so.
		expect(chosen()).toEqual(['Midnight Ink']);
	});

	it('keeps a saved look where the collection could not be read', async () => {
		broken = true;
		localStorage.setItem('sloppy_prefs', JSON.stringify({ look: NORD.slug }));
		prefs.init();

		show();
		await settle();

		expect(prefs.current.look).toBe(NORD.slug);
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
		const second = nameOf(rows()[1]);
		type('ArrowDown');
		type('Enter');
		expect(chosen()).toEqual([second]);

		type('End');
		type(' ');
		expect(prefs.dressing).not.toBeNull();
		expect(chosen()).toEqual([nameOf(rows()[rows().length - 1])]);

		type('Home');
		type(' ');
		expect(prefs.dressing).toBeNull();
		expect(chosen()).toEqual([LOOK_LABELS.paper]);
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
