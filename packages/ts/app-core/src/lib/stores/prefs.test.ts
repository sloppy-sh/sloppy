import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
			JSON.stringify({ theme: 'neon', accent: 42, style: 'sketch' })
		);
		prefs.init();
		expect(prefs.current).toEqual({
			theme: 'paper',
			accent: 'indigo',
			style: 'default',
			lens: null
		});
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
