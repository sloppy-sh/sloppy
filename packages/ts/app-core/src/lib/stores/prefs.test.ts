import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { OwnedRef } from '@sloppy/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DID, ref } from './fake-api.test-support.js';
import { THEMES, asOrigin, prefs, storedOrigin } from './prefs.svelte.js';

const UI_CSS = readFileSync(resolve(process.cwd(), '../ui/src/lib/app.css'), 'utf8').replace(
	/\/\*[\s\S]*?\*\//g,
	''
);

function stylesheetCallsDark(theme: string): boolean {
	for (const [, selector, declarations] of UI_CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		const claims = selector.split(',').some((s) => s.trim().endsWith(`[data-theme='${theme}']`));
		if (claims && declarations.includes('--background:'))
			return /color-scheme:\s*dark\s*;/.test(declarations);
	}
	throw new Error(`no ground declared for ${theme}`);
}

/** The look the boot script or the store has left on `<html>`. */
function stamped(): Record<string, string | null> {
	const root = document.documentElement;
	return {
		theme: root.getAttribute('data-theme'),
		accent: root.getAttribute('data-accent'),
		style: root.getAttribute('data-style'),
		font: root.getAttribute('data-app-font'),
		dark: String(root.classList.contains('dark'))
	};
}

function unstamp(): void {
	const root = document.documentElement;
	for (const axis of ['data-theme', 'data-accent', 'data-style', 'data-app-font'])
		root.removeAttribute(axis);
	root.classList.remove('dark');
}

function bootScript(shell: string): () => void {
	const html = readFileSync(
		resolve(process.cwd(), `../../../apps/sloppy/${shell}/src/app.html`),
		'utf8'
	);
	const found = /<script>([\s\S]*?)<\/script>/.exec(html);
	if (!found) throw new Error(`the ${shell} shell has no boot script`);
	return new Function(found[1]) as () => void;
}

function osPrefersDark(dark: boolean) {
	vi.stubGlobal('matchMedia', (query: string) => ({
		matches: dark && query.includes('dark'),
		media: query,
		addEventListener: () => {},
		removeEventListener: () => {}
	}));
}

beforeEach(() => {
	localStorage.clear();
	osPrefersDark(false);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('the saved look', () => {
	it('opens a first visit on Paper under a light OS', () => {
		prefs.init();
		expect(prefs.current.theme).toBe('paper');
		expect(document.documentElement.getAttribute('data-theme')).toBe('paper');
	});

	it('opens a first visit on Graphite under a dark OS', () => {
		osPrefersDark(true);
		prefs.init();
		expect(prefs.current.theme).toBe('graphite');
		expect(document.documentElement.classList.contains('dark')).toBe(true);
	});

	it('lets the saved choice win over the OS on every later visit', () => {
		localStorage.setItem('sloppy_prefs', JSON.stringify({ theme: 'paper' }));
		osPrefersDark(true);
		prefs.init();
		expect(prefs.current.theme).toBe('paper');
	});

	it('carries a choice to the next visit', () => {
		prefs.init();
		prefs.set('accent', 'moss');
		prefs.init();
		expect(prefs.current.accent).toBe('moss');
	});

	it('leaves data-style absent for the default style, because absent IS default', () => {
		prefs.init();
		expect(document.documentElement.hasAttribute('data-style')).toBe(false);
		prefs.set('style', 'hardline');
		expect(document.documentElement.getAttribute('data-style')).toBe('hardline');
		prefs.set('style', 'default');
		expect(document.documentElement.hasAttribute('data-style')).toBe(false);
	});

	it('leaves data-app-font absent for the default face, because absent IS default', () => {
		prefs.init();
		expect(document.documentElement.hasAttribute('data-app-font')).toBe(false);
		prefs.set('font', 'opendyslexic');
		expect(document.documentElement.getAttribute('data-app-font')).toBe('opendyslexic');
		prefs.set('font', 'system');
		expect(document.documentElement.hasAttribute('data-app-font')).toBe(false);
	});

	// Both shells paint the first paint from the same saved object, so what they
	// stamp is held against the store rather than against a copy of the rules.
	it.each(['web', 'native'])('paints the %s shell the way the store would', (shell) => {
		for (const saved of [
			{},
			{ theme: 'dark', accent: 'moss', style: 'hardline', font: 'opendyslexic' },
			{ theme: 'contrast', accent: 'sea', style: 'default', font: 'system' }
		]) {
			localStorage.setItem('sloppy_prefs', JSON.stringify(saved));
			prefs.init();
			const byTheStore = stamped();
			unstamp();
			bootScript(shell)();
			expect(stamped()).toEqual(byTheStore);
		}
	});

	it('agrees with the boot script about which themes are dark', () => {
		for (const [theme, dark] of [
			['paper', false],
			['graphite', true],
			['light', false],
			['dark', true],
			['contrast', false]
		] as const) {
			prefs.set('theme', theme);
			expect(prefs.isDark).toBe(dark);
			expect(document.documentElement.classList.contains('dark')).toBe(dark);
		}
	});

	// app.css declares `color-scheme`; `isDark` draws the `dark` class. One fact.
	it('calls a theme dark the way the stylesheet does', () => {
		for (const theme of THEMES) {
			prefs.set('theme', theme);
			expect(prefs.isDark).toBe(stylesheetCallsDark(theme));
		}
	});

	it('falls back to a default rather than trusting a value it does not know', () => {
		localStorage.setItem(
			'sloppy_prefs',
			JSON.stringify({
				theme: 'neon',
				accent: 42,
				style: 'sketch',
				font: 'comic',
				tags: 'seed',
				ground: 'graph paper',
				graph: 'not a ref',
				alsoOnCanvas: ['neither is this'],
				wallpapers: 'a picture',
				walking: 'yes',
				readingWidth: 'wide',
				origin: 'nowhere at all/ /'
			})
		);
		prefs.init();
		expect(prefs.current).toEqual({
			theme: 'paper',
			accent: 'indigo',
			style: 'default',
			font: 'system',
			tags: [],
			ground: 'dots',
			graph: null,
			alsoOnCanvas: [],
			wallpapers: {},
			walking: false,
			readingWidth: null,
			origin: null
		});
	});

	// PRODUCT.md § "Accessibility & Inclusion": reading the graph as an outline
	// is a preference, so it is waiting the next time the app opens.
	it('opens on the outline again for a reader who left it there', () => {
		prefs.init();
		expect(prefs.current.walking).toBe(false);
		prefs.set('walking', true);
		prefs.init();
		expect(prefs.current.walking).toBe(true);
	});

	// Which graph somebody is in, and which they have stood up beside it, are
	// this device's — DESIGN.md § Persistence.
	it('brings back the graphs the canvas was left showing', () => {
		const home = `${DID}/00000000000000000000000000` as OwnedRef;
		const garden = ref(20);
		prefs.set('graph', home);
		prefs.set('alsoOnCanvas', [garden]);
		prefs.init();
		expect(prefs.current.graph).toBe(home);
		expect(prefs.current.alsoOnCanvas).toEqual([garden]);
	});

	// DESIGN.md § "The wallpaper": a picture belongs to the graph it is under,
	// so what one graph is drawn over says nothing about another.
	it('keeps each graph its own picture', () => {
		const home = `${DID}/00000000000000000000000000` as OwnedRef;
		const garden = ref(20);
		prefs.init();
		prefs.setWallpaper(home, { pictures: ['a'], strength: 0.3, every: 60, transition: 'fade' });
		expect(prefs.wallpaper(home)?.pictures).toEqual(['a']);
		expect(prefs.wallpaper(garden)).toBeNull();

		prefs.setWallpaper(home, null);
		expect(prefs.wallpaper(home)).toBeNull();
		expect(prefs.current.wallpapers).toEqual({});
	});

	// The order the tags were selected in is what assigns their hues, so a
	// saved selection has to come back in it — a sort here would repaint the
	// canvas differently from the rail that was showing when it was saved.
	it('brings a saved selection back in the order it was made', () => {
		localStorage.setItem(
			'sloppy_prefs',
			JSON.stringify({ tags: ['seed', 'BIOLOGY', 'seed', 'bio\u200blogy', 7] })
		);
		prefs.init();
		expect(prefs.current.tags).toEqual(['seed', 'biology']);
	});

	it('still opens when the browser is told to block site data', () => {
		const blocked = () => {
			throw new Error('The operation is insecure.');
		};
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
		expect(() => {
			prefs.init();
			prefs.set('accent', 'sea');
		}).not.toThrow();
		expect(prefs.current.accent).toBe('sea');
		vi.restoreAllMocks();
	});
});

describe('where this device says its Sloppy is', () => {
	it('is nowhere of its own until somebody names one', () => {
		prefs.init();
		expect(prefs.current.origin).toBeNull();
		expect(storedOrigin()).toBeNull();
	});

	it('keeps only what an app could be reached at, however it was typed', () => {
		expect(asOrigin('https://sloppy.example.com')).toBe('https://sloppy.example.com');
		expect(asOrigin('  sloppy.example.com  ')).toBe('https://sloppy.example.com');
		expect(asOrigin('http://localhost:8020/')).toBe('http://localhost:8020');
		// A path typed after the address cannot re-root the app.
		expect(asOrigin('https://sloppy.example.com/somebody/else')).toBe('https://sloppy.example.com');
		expect(asOrigin('javascript:alert(1)')).toBeNull();
		expect(asOrigin('file:///etc/hosts')).toBeNull();
		expect(asOrigin('')).toBeNull();
		expect(asOrigin(7)).toBeNull();
	});

	// The app is pointed at it before any page mounts, which is before init().
	it('is readable before the saved look has been read', () => {
		localStorage.setItem('sloppy_prefs', JSON.stringify({ origin: 'https://mine.example' }));
		expect(storedOrigin()).toBe('https://mine.example');
	});

	it('survives the look being read back', () => {
		prefs.init();
		prefs.set('origin', 'https://mine.example');
		prefs.init();
		expect(prefs.current.origin).toBe('https://mine.example');
	});

	// A graph, the canvas beside it and the pictures under them were minted by
	// the Sloppy being left, so none of them follows the device to another one.
	it('leaves the canvas behind wherever the device is pointed', () => {
		const home = `${DID}/00000000000000000000000000` as OwnedRef;
		prefs.init();
		prefs.set('graph', home);
		prefs.set('alsoOnCanvas', [ref(20)]);
		prefs.setWallpaper(home, { pictures: ['a'], strength: 0.3, every: 60, transition: 'fade' });

		prefs.set('origin', 'https://mine.example');

		expect(prefs.current.graph).toBeNull();
		expect(prefs.current.alsoOnCanvas).toEqual([]);
		expect(prefs.current.wallpapers).toEqual({});
		expect(prefs.current.origin).toBe('https://mine.example');
	});

	it('keeps the canvas where the address given is the one it is already on', () => {
		const home = `${DID}/00000000000000000000000000` as OwnedRef;
		prefs.init();
		prefs.set('origin', 'https://mine.example');
		prefs.set('graph', home);

		prefs.set('origin', 'https://mine.example');

		expect(prefs.current.graph).toBe(home);
	});

	it('goes back to the one the app came with', () => {
		prefs.init();
		prefs.set('origin', 'https://mine.example');
		prefs.set('origin', null);
		expect(storedOrigin()).toBeNull();
	});
});
