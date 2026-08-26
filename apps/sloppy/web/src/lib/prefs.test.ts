import { beforeEach, describe, expect, it } from 'vitest';
import { prefs } from './prefs.svelte.js';

const root = () => document.documentElement;

function stored(): Record<string, unknown> {
	return JSON.parse(localStorage.getItem('sloppy_prefs') ?? '{}');
}

beforeEach(() => {
	localStorage.clear();
	root().removeAttribute('data-theme');
	root().removeAttribute('data-accent');
	root().removeAttribute('data-style');
	root().classList.remove('dark');
	prefs.set({ theme: 'paper', accent: 'indigo', style: 'default' });
	localStorage.clear();
});

describe('prefs', () => {
	it('carries the dark class for the dark-family themes only', () => {
		prefs.set({ theme: 'graphite' });
		expect(root().getAttribute('data-theme')).toBe('graphite');
		expect(root().classList.contains('dark')).toBe(true);

		prefs.set({ theme: 'contrast' });
		expect(root().classList.contains('dark')).toBe(false);
	});

	it('leaves data-style off for the default style', () => {
		prefs.set({ style: 'hardline' });
		expect(root().getAttribute('data-style')).toBe('hardline');

		prefs.set({ style: 'default' });
		expect(root().hasAttribute('data-style')).toBe(false);
	});

	it('keeps preferences it does not own', () => {
		localStorage.setItem('sloppy_prefs', JSON.stringify({ lens: 'domain', theme: 'paper' }));
		prefs.set({ accent: 'moss' });
		expect(stored()).toMatchObject({ lens: 'domain', accent: 'moss' });
	});

	it('adopts what the boot script painted', () => {
		root().setAttribute('data-theme', 'dark');
		root().setAttribute('data-accent', 'sea');
		prefs.init();
		expect(prefs.theme).toBe('dark');
		expect(prefs.accent).toBe('sea');
		expect(prefs.style).toBe('default');
	});

	it('ignores an attribute that names no preset', () => {
		root().setAttribute('data-accent', 'chartreuse');
		prefs.init();
		expect(prefs.accent).toBe('indigo');
	});
});
