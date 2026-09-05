import type { OwnedRef } from '@sloppy/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DID, ref } from './fake-api.test-support.js';
import { prefs } from './prefs.svelte.js';

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

	it('falls back to a default rather than trusting a value it does not know', () => {
		localStorage.setItem(
			'sloppy_prefs',
			JSON.stringify({
				theme: 'neon',
				accent: 42,
				style: 'sketch',
				tags: 'seed',
				ground: 'graph paper',
				graph: 'not a ref',
				alsoOnCanvas: ['neither is this'],
				wallpapers: 'a picture',
				readingWidth: 'wide'
			})
		);
		prefs.init();
		expect(prefs.current).toEqual({
			theme: 'paper',
			accent: 'indigo',
			style: 'default',
			tags: [],
			ground: 'dots',
			graph: null,
			alsoOnCanvas: [],
			wallpapers: {},
			readingWidth: null
		});
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
