import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { OwnedRef } from '@sloppy/types';
import type { SchemeDressing, SchemeTokens } from '@sloppy/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DID, ref } from './fake-api.test-support.js';
import {
	type FolderView,
	MOST_VIEWS,
	THEMES,
	asOrigin,
	prefs,
	storedOrigin
} from './prefs.svelte.js';

const GARDEN = '/Users/me/Garden';
const THESIS = '/Users/me/thesis';

/** A scheme as it arrives resolved: a slug, which way its ground runs, and the
 *  paint. The collection it comes out of is not this file's business. */
const GRUVBOX: SchemeDressing = {
	slug: 'gruvbox-dark-hard',
	variant: 'dark',
	tokens: { '--background': '#1d2021', '--foreground': '#d5c4a1', '--facet-1': '#fb4934' }
};

const SOLARIZED: SchemeDressing = {
	slug: 'solarized-light',
	variant: 'light',
	tokens: { '--background': '#fdf6e3' }
};

/** A folder read with nothing open and nothing folded. */
const READING: FolderView = {
	graph: null,
	alsoOnCanvas: [],
	tags: [],
	walking: false,
	folded: [],
	unfolded: []
};

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

/** The tokens painted inline on `<html>`, which is the whole of what a scheme
 *  is on the page. */
function painted(): Record<string, string> {
	const style = document.documentElement.style;
	const out: Record<string, string> = {};
	for (let at = 0; at < style.length; at += 1) {
		const token = style.item(at);
		if (token.startsWith('--')) out[token] = style.getPropertyValue(token).trim();
	}
	return out;
}

/** The look the boot script or the store has left on `<html>`. */
function stamped(): Record<string, unknown> {
	const root = document.documentElement;
	return {
		theme: root.getAttribute('data-theme'),
		scheme: root.getAttribute('data-scheme'),
		accent: root.getAttribute('data-accent'),
		style: root.getAttribute('data-style'),
		font: root.getAttribute('data-app-font'),
		effect: root.getAttribute('data-effect'),
		dark: String(root.classList.contains('dark')),
		painted: painted()
	};
}

function unstamp(): void {
	const root = document.documentElement;
	for (const axis of [
		'data-theme',
		'data-scheme',
		'data-accent',
		'data-style',
		'data-app-font',
		'data-effect'
	])
		root.removeAttribute(axis);
	for (const token of Object.keys(painted())) root.style.removeProperty(token);
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
	unstamp();
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

	it('leaves data-effect absent for a plain screen, because absent IS plain', () => {
		prefs.init();
		expect(document.documentElement.hasAttribute('data-effect')).toBe(false);
		prefs.set('effect', 'crt');
		expect(document.documentElement.getAttribute('data-effect')).toBe('crt');
		prefs.set('effect', 'none');
		expect(document.documentElement.hasAttribute('data-effect')).toBe(false);
	});

	// Both shells paint the first paint from the same saved object, so what they
	// stamp is held against the store rather than against a copy of the rules.
	it.each(['web', 'native'])('paints the %s shell the way the store would', (shell) => {
		const cases: [Record<string, unknown>, SchemeDressing | null][] = [
			[{}, null],
			[{ theme: 'dark', accent: 'moss', style: 'hardline', font: 'opendyslexic' }, null],
			[{ theme: 'contrast', accent: 'sea', style: 'default', font: 'system' }, null],
			[{ style: 'bevel', effect: 'crt' }, null],
			[{ scheme: GRUVBOX.slug }, GRUVBOX],
			// A dressing reaching for a token another axis owns: neither painter
			// gives it up, so both leave the same thing on <html>.
			[
				{ scheme: GRUVBOX.slug },
				{ ...GRUVBOX, tokens: { ...GRUVBOX.tokens, '--border': '#504945', '--ring': '#83a598' } }
			],
			// A dressing cached for another scheme is not this one's paint, so
			// neither of them dresses the app: the theme does.
			[{ scheme: SOLARIZED.slug }, GRUVBOX]
		];
		for (const [saved, dressing] of cases) {
			localStorage.setItem('sloppy_prefs', JSON.stringify(saved));
			if (dressing === null) localStorage.removeItem('sloppy_scheme');
			else localStorage.setItem('sloppy_scheme', JSON.stringify(dressing));
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
				scheme: 'Not A Slug!',
				accent: 42,
				style: 'sketch',
				effect: 'glow',
				font: 'comic',
				tags: 'seed',
				ground: 'graph paper',
				graph: 'not a ref',
				alsoOnCanvas: ['neither is this'],
				wallpapers: 'a picture',
				views: 'how it was read',
				walking: 'yes',
				readingWidth: 'wide',
				chatWidth: 'narrow',
				chatModel: { claude_code: 'a model from later', nobody: 'opus' },
				origin: 'nowhere at all/ /'
			})
		);
		prefs.init();
		expect(prefs.current).toEqual({
			theme: 'paper',
			scheme: null,
			accent: 'indigo',
			style: 'default',
			effect: 'none',
			font: 'system',
			tags: [],
			ground: 'dots',
			graph: null,
			alsoOnCanvas: [],
			wallpapers: {},
			views: {},
			walking: false,
			recordsWhatHappens: false,
			readingWidth: null,
			readingFull: false,
			chatWidth: null,
			deskNavOpen: true,
			tagOrder: 'count',
			columnGroups: { history: false, tags: true },
			density: 'auto',
			autosave: false,
			autosaveMinutes: 5,
			aiOffered: false,
			chatAgent: null,
			// A model this build does not name is still the person's to ask for;
			// an agent this build does not know is not.
			chatModel: { claude_code: 'a model from later' },
			chatInBackground: false,
			chatReachesWeb: true,
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

	// docs/ARCHITECTURE.md § "Several folders open at once": a tab comes back to
	// how its folder was being read, so what is kept for one folder says nothing
	// about another.
	it('keeps each folder how it was last being read', () => {
		const garden = ref(20);
		prefs.init();
		prefs.setView(GARDEN, { ...READING, graph: garden, note: ref(21) });

		expect(prefs.view(GARDEN)?.graph).toBe(garden);
		expect(prefs.view(THESIS)).toBeNull();

		prefs.init();
		expect(prefs.view(GARDEN)?.note).toBe(ref(21));

		prefs.setView(GARDEN, null);
		expect(prefs.view(GARDEN)).toBeNull();
		expect(prefs.current.views).toEqual({});
	});

	it('reads back what it can of a saved view and drops the rest', () => {
		localStorage.setItem(
			'sloppy_prefs',
			JSON.stringify({
				views: {
					[GARDEN]: {
						graph: 'not a ref',
						alsoOnCanvas: ['neither is this'],
						tags: ['seed', 7],
						walking: 'yes',
						note: 'nor this',
						folded: [ref(20)],
						unfolded: 'none of them',
						viewport: { x: 10, y: -4, scale: 0 }
					},
					[THESIS]: 'how it was read'
				}
			})
		);
		prefs.init();

		expect(prefs.view(GARDEN)).toEqual({
			graph: null,
			alsoOnCanvas: [],
			tags: ['seed'],
			walking: false,
			folded: [ref(20)],
			unfolded: []
		});
		expect(prefs.view(THESIS)).toBeNull();
	});

	it('keeps a viewport only where every part of it is a place on the canvas', () => {
		prefs.init();
		prefs.setView(GARDEN, { ...READING, viewport: { x: 12, y: -30, scale: 1.5 } });
		prefs.init();
		expect(prefs.view(GARDEN)?.viewport).toEqual({ x: 12, y: -30, scale: 1.5 });
	});

	// A dozen is plenty, and the folder read most recently is the last to go —
	// writing a view again is what puts it at the end of the queue.
	it('keeps a dozen folders, the one read longest ago going first', () => {
		prefs.init();
		for (let at = 0; at <= MOST_VIEWS; at += 1) prefs.setView(`/folders/${at}`, READING);
		prefs.setView('/folders/1', READING);
		prefs.setView(`/folders/${MOST_VIEWS + 1}`, READING);

		expect(Object.keys(prefs.current.views)).toHaveLength(MOST_VIEWS);
		expect(prefs.view('/folders/0')).toBeNull();
		expect(prefs.view('/folders/2')).toBeNull();
		expect(prefs.view('/folders/1')).not.toBeNull();
		expect(prefs.view(`/folders/${MOST_VIEWS + 1}`)).not.toBeNull();
	});

	// A chat answering in a tab somebody has left is a thing they asked for, so
	// it waits until they do.
	it('leaves a chat waiting in a tab somebody has left until it is asked not to', () => {
		prefs.init();
		expect(prefs.current.chatInBackground).toBe(false);
		prefs.set('chatInBackground', true);
		prefs.init();
		expect(prefs.current.chatInBackground).toBe(true);
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

describe('the scheme dressing the app', () => {
	it('dresses the app in one, and hands it back to the theme', () => {
		const root = document.documentElement;
		prefs.init();
		prefs.setScheme(GRUVBOX);

		expect(prefs.current.scheme).toBe(GRUVBOX.slug);
		expect(root.getAttribute('data-theme')).toBe('scheme');
		expect(root.getAttribute('data-scheme')).toBe(GRUVBOX.slug);
		expect(painted()).toEqual(GRUVBOX.tokens);
		// Which way the ground runs is the scheme's own answer, not the theme's.
		expect(prefs.isDark).toBe(true);
		expect(root.classList.contains('dark')).toBe(true);

		prefs.setScheme(null);

		expect(prefs.current.scheme).toBeNull();
		expect(root.hasAttribute('data-scheme')).toBe(false);
		expect(painted()).toEqual({});
		expect(root.getAttribute('data-theme')).toBe('paper');
		expect(prefs.isDark).toBe(false);
	});

	// DESIGN.md § Schemes: the accent is the person's across every scheme, and a
	// style draws its own edge on one, so a dressing offering either is not it.
	it('paints nothing another axis owns', () => {
		prefs.init();
		prefs.setScheme({
			slug: 'gruvbox-dark-hard',
			variant: 'dark',
			tokens: {
				'--background': '#1d2021',
				'--border': '#504945',
				'--ring': '#83a598',
				'--primary': '#83a598'
			}
		});

		expect(painted()).toEqual({ '--background': '#1d2021' });
		// And the copy the shells' boot scripts paint the first paint from.
		expect(JSON.parse(localStorage.getItem('sloppy_scheme') ?? 'null').tokens).toEqual({
			'--background': '#1d2021'
		});
	});

	// Two dressings do not carry the same tokens, so what one painted has to come
	// off before the next one goes on.
	it('takes the last one off before painting another', () => {
		prefs.init();
		prefs.setScheme(GRUVBOX);
		prefs.setScheme(SOLARIZED);
		expect(painted()).toEqual(SOLARIZED.tokens);
	});

	// The inset vars live inline on <html> too, and they are not a scheme's to
	// clear — DESIGN.md § "The four inset vars".
	it('leaves an inline property that is not a scheme alone', () => {
		prefs.init();
		document.documentElement.style.setProperty('--safe-area-inset-bottom', '48px');
		prefs.setScheme(GRUVBOX);
		prefs.setScheme(null);
		expect(document.documentElement.style.getPropertyValue('--safe-area-inset-bottom')).toBe(
			'48px'
		);
		document.documentElement.style.removeProperty('--safe-area-inset-bottom');
	});

	it('stands a scheme down when a theme is asked for', () => {
		prefs.init();
		prefs.setScheme(GRUVBOX);
		prefs.set('theme', 'light');

		expect(prefs.current.scheme).toBeNull();
		expect(document.documentElement.getAttribute('data-theme')).toBe('light');
		expect(painted()).toEqual({});
		expect(localStorage.getItem('sloppy_scheme')).toBeNull();
	});

	it('carries a dressing to the next visit', () => {
		prefs.init();
		prefs.setScheme(GRUVBOX);
		prefs.init();
		expect(prefs.current.scheme).toBe(GRUVBOX.slug);
		expect(painted()).toEqual(GRUVBOX.tokens);
	});

	// The slug is the choice; the paint is a copy of what the collection says.
	// Losing the copy is not losing the choice — the collection resolves it again.
	it('keeps the scheme somebody chose when the paint is not cached', () => {
		localStorage.setItem('sloppy_prefs', JSON.stringify({ scheme: GRUVBOX.slug }));
		prefs.init();
		expect(prefs.current.scheme).toBe(GRUVBOX.slug);
		expect(prefs.dressing).toBeNull();
		expect(document.documentElement.getAttribute('data-theme')).toBe('paper');
		expect(painted()).toEqual({});
	});

	it('paints custom properties, and paints nothing that is not paint', () => {
		prefs.init();
		prefs.setScheme({
			slug: 'tampered',
			variant: 'light',
			tokens: {
				'--background': '#fdf6e3',
				background: 'red',
				'--leak': 'url(https://elsewhere.example/pixel.png)',
				'--escapes': 'red; position: fixed',
				'--long': 'x'.repeat(200)
			} as unknown as SchemeTokens
		});
		expect(painted()).toEqual({ '--background': '#fdf6e3' });
		expect(document.documentElement.style.getPropertyValue('background')).toBe('');
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
		prefs.setView(GARDEN, READING);

		prefs.set('origin', 'https://mine.example');

		expect(prefs.current.graph).toBeNull();
		expect(prefs.current.alsoOnCanvas).toEqual([]);
		expect(prefs.current.wallpapers).toEqual({});
		expect(prefs.current.views).toEqual({});
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
