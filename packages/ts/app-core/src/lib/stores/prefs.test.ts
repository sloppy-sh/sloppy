import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { OwnedRef } from '@sloppy/types';
import type { SchemeDressing, SchemeTokens } from '@sloppy/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DID, ref } from './fake-api.test-support.js';
import {
	BUILT_IN_LOOKS,
	type FolderView,
	MOST_VIEWS,
	asOrigin,
	prefs,
	storedOrigin
} from './prefs.svelte.js';

const GARDEN = '/Users/me/Garden';
const THESIS = '/Users/me/thesis';

/** A look carried as data, as it arrives resolved: its id, which way its ground
 *  runs, and the paint. The collection it comes out of is not this file's
 *  business. */
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
	seenAs: 'graph',
	folded: [],
	unfolded: []
};

const UI_CSS = readFileSync(resolve(process.cwd(), '../ui/src/lib/app.css'), 'utf8').replace(
	/\/\*[\s\S]*?\*\//g,
	''
);

function stylesheetCallsDark(look: string): boolean {
	for (const [, selector, declarations] of UI_CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		const claims = selector.split(',').some((s) => s.trim().endsWith(`[data-look='${look}']`));
		if (claims && declarations.includes('--background:'))
			return /color-scheme:\s*dark\s*;/.test(declarations);
	}
	throw new Error(`no ground declared for ${look}`);
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

/** The look's own rules as they stand on the page, or null where none do. */
function rules(): string | null {
	return document.getElementById('sloppy-look')?.textContent ?? null;
}

/** The look the boot script or the store has left on the page. */
function stamped(): Record<string, unknown> {
	const root = document.documentElement;
	return {
		look: root.getAttribute('data-look'),
		style: root.getAttribute('data-style'),
		density: root.getAttribute('data-density'),
		effect: root.getAttribute('data-effect'),
		reach: root.getAttribute('data-screen-reach'),
		dark: String(root.classList.contains('dark')),
		painted: painted(),
		rules: rules()
	};
}

function unstamp(): void {
	const root = document.documentElement;
	for (const axis of [
		'data-look',
		'data-style',
		'data-density',
		'data-effect',
		'data-screen-reach'
	])
		root.removeAttribute(axis);
	for (const token of Object.keys(painted())) root.style.removeProperty(token);
	root.classList.remove('dark');
	document.getElementById('sloppy-look')?.remove();
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
		expect(prefs.current.look).toBe('paper');
		expect(document.documentElement.getAttribute('data-look')).toBe('paper');
	});

	it('opens a first visit on Graphite under a dark OS', () => {
		osPrefersDark(true);
		prefs.init();
		expect(prefs.current.look).toBe('graphite');
		expect(document.documentElement.classList.contains('dark')).toBe(true);
	});

	it('lets the saved choice win over the OS on every later visit', () => {
		localStorage.setItem('sloppy_prefs', JSON.stringify({ look: 'paper' }));
		osPrefersDark(true);
		prefs.init();
		expect(prefs.current.look).toBe('paper');
	});

	it('carries a choice to the next visit', () => {
		prefs.init();
		prefs.set('style', 'hardline');
		prefs.init();
		expect(prefs.current.style).toBe('hardline');
	});

	// The theme, the scheme and the face an earlier build kept are the look and
	// the face of those names; the accent it kept is the one that look carries.
	it('carries a look chosen on an earlier build over to the look it names', () => {
		localStorage.setItem(
			'sloppy_prefs',
			JSON.stringify({ theme: 'dark', accent: 'moss', font: 'opendyslexic' })
		);
		prefs.init();
		expect(prefs.current.look).toBe('dark');
		expect(prefs.current.fonts).toEqual({
			ui: 'opendyslexic',
			heading: 'opendyslexic',
			mono: 'opendyslexic'
		});
		expect('accent' in prefs.current).toBe(false);

		localStorage.setItem('sloppy_prefs', JSON.stringify({ theme: 'dark', scheme: GRUVBOX.slug }));
		localStorage.setItem('sloppy_scheme', JSON.stringify(GRUVBOX));
		prefs.init();
		expect(prefs.current.look).toBe(GRUVBOX.slug);
		expect(painted()).toEqual(GRUVBOX.tokens);
	});

	it('leaves data-style absent for the default style, because absent IS default', () => {
		prefs.init();
		expect(document.documentElement.hasAttribute('data-style')).toBe(false);
		prefs.set('style', 'hardline');
		expect(document.documentElement.getAttribute('data-style')).toBe('hardline');
		prefs.set('style', 'default');
		expect(document.documentElement.hasAttribute('data-style')).toBe(false);
	});

	it('keeps a face for each of the three, and carries all three over', () => {
		prefs.init();
		expect(prefs.current.fonts).toEqual({ ui: 'system', heading: 'system', mono: 'system' });
		prefs.set('fonts', { ui: 'opendyslexic', heading: 'Iosevka Etoile', mono: 'system' });
		prefs.init();
		expect(prefs.current.fonts).toEqual({
			ui: 'opendyslexic',
			heading: 'Iosevka Etoile',
			mono: 'system'
		});
	});

	// Somebody who needs a face to read the page at all has to be reading the
	// page in it, and a look asking for a family this build does not ship still
	// has to read — DESIGN.md § Typography.
	it('reads each of the three in the face somebody kept, over the stack it had', () => {
		prefs.init();
		expect(painted()).toEqual({});
		prefs.set('fonts', { ui: 'opendyslexic', heading: 'Iosevka Etoile', mono: 'apple' });
		expect(painted()).toEqual({
			'--font-sans': "'OpenDyslexic', var(--font-proportional)",
			'--font-heading': '"Iosevka Etoile", var(--font-sans)',
			'--font-mono': 'ui-monospace, SFMono-Regular, Menlo, var(--font-monospaced)'
		});
		prefs.init();
		expect(painted()['--font-sans']).toBe("'OpenDyslexic', var(--font-proportional)");
		// A heading falls back to the app's own face, not to the stack that face
		// was chosen over: one face set for the app is read on the headings too.
		expect(painted()['--font-heading']).toContain('var(--font-sans)');
		prefs.set('fonts', { ui: 'system', heading: 'system', mono: 'system' });
		expect(painted()).toEqual({});
	});

	// Legibility outranks alignment: a reader who needs OpenDyslexic to read an
	// address at all does not get an exception carved out of it for our nicest
	// column — DESIGN.md § Typography.
	it('keeps an address in one column until the face for it cannot', () => {
		prefs.init();
		prefs.set('fonts', { ui: 'system', heading: 'system', mono: 'opendyslexic' });
		expect(painted()['--font-address-figures']).toBe('normal');
		expect(painted()['--font-address-features']).toBe('normal');
		// A family nobody here ships is the person's to ask for, and nothing here
		// knows whether it holds a column — so the guarantee stands.
		prefs.set('fonts', { ui: 'system', heading: 'system', mono: 'Iosevka Etoile' });
		expect(painted()['--font-address-figures']).toBeUndefined();
	});

	// A face is a name, and a name is written into a declaration of its own.
	it('refuses a face that is not a name at all', () => {
		localStorage.setItem(
			'sloppy_prefs',
			JSON.stringify({ fonts: { ui: 'x; position: fixed', heading: 'url(http://a.example/f)' } })
		);
		prefs.init();
		expect(prefs.current.fonts).toEqual({ ui: 'system', heading: 'system', mono: 'system' });
		expect(painted()).toEqual({});
		// A look laid over what is standing does not come through `init()`, and
		// the one place a name reaches a declaration is the same place either way.
		prefs.set('fonts', { ui: 'x; position: fixed', heading: 'system', mono: 'system' });
		expect(painted()).toEqual({});
	});

	it('leaves data-effect absent for a plain screen, because absent IS plain', () => {
		prefs.init();
		expect(document.documentElement.hasAttribute('data-effect')).toBe(false);
		prefs.set('effects', ['crt']);
		expect(document.documentElement.getAttribute('data-effect')).toBe('crt');
		prefs.set('effects', []);
		expect(document.documentElement.hasAttribute('data-effect')).toBe(false);
	});

	// Several screens are drawn at once, and the page says so the same way on
	// every device: the order the stylesheet draws them in, never the order
	// somebody happened to tap them.
	it('stamps every screen on at once, in the one order', () => {
		prefs.init();
		prefs.set('effects', ['crt', 'grain', 'crt']);
		expect(document.documentElement.getAttribute('data-effect')).toBe('grain crt');
		expect(prefs.current.effects).toEqual(['grain', 'crt']);
	});

	// The one screen an earlier build kept is the screen this one opens on.
	it('wears the screen an earlier build saved', () => {
		localStorage.setItem('sloppy_prefs', JSON.stringify({ effect: 'hatch' }));
		prefs.init();
		expect(prefs.current.effects).toEqual(['hatch']);
		expect(document.documentElement.getAttribute('data-effect')).toBe('hatch');
	});

	it('writes how much of each screen there is, and where they reach', () => {
		prefs.init();
		// At rest is absent, the same bargain every other axis makes.
		expect(painted()).toEqual({});
		expect(document.documentElement.hasAttribute('data-screen-reach')).toBe(false);

		prefs.set('screens', { grain: { strength: 2.5, scale: 0.4 }, crt: { strength: 1, scale: 2 } });
		prefs.set('screenReach', 'edges');

		// One screen moved says nothing about another, and a number at rest is
		// not written down at all.
		expect(painted()).toEqual({
			'--screen-grain-strength': '2.5',
			'--screen-grain-scale': '0.4',
			'--screen-crt-scale': '2'
		});
		expect(document.documentElement.getAttribute('data-screen-reach')).toBe('edges');

		// A screen slid back to rest is one this device says nothing about.
		prefs.set('screens', { ...prefs.current.screens, grain: { strength: 1, scale: 1 } });
		expect(prefs.current.screens.grain).toBeUndefined();

		prefs.set('screens', {});
		prefs.set('screenReach', 'everywhere');
		expect(painted()).toEqual({});
		expect(document.documentElement.hasAttribute('data-screen-reach')).toBe(false);
	});

	// The numbers an earlier build kept for the one screen it drew were that
	// screen's, and that screen is whichever of them was on.
	it('gives every screen the numbers an earlier build kept for one', () => {
		localStorage.setItem(
			'sloppy_prefs',
			JSON.stringify({ effect: 'hatch', screen: { strength: 2, scale: 0.5, edges: true } })
		);
		prefs.init();
		expect(prefs.current.screens.hatch).toEqual({ strength: 2, scale: 0.5 });
		expect(prefs.current.screens.grain).toEqual({ strength: 2, scale: 0.5 });
		expect(prefs.current.screenReach).toBe('edges');
	});

	// Both shells paint the first paint from the same saved object, so what they
	// stamp is held against the store rather than against a copy of the rules.
	it.each(['web', 'native'])('paints the %s shell the way the store would', (shell) => {
		const cases: [Record<string, unknown>, SchemeDressing | null, string?][] = [
			[{}, null],
			[{ look: 'dark', style: 'hardline' }, null],
			[{ look: 'contrast', style: 'default', density: 'compact' }, null],
			[{ style: 'bevel', effect: 'crt' }, null],
			[{ effects: ['crt', 'grain'] }, null],
			[{ effects: ['grain', 'nothing of the sort'] }, null],
			[{ effects: 'hatch' }, null],
			// How much of a screen there is, as the reader left it — and a number
			// nobody could have meant, which both painters draw at rest instead.
			[{ effect: 'grain', screen: { strength: 2.4, scale: 0.5, edges: true } }, null],
			[{ effect: 'grain', screen: { strength: 9, scale: 'big', edges: 'yes' } }, null],
			[{ effect: 'grain', screen: 'a lot' }, null],
			[
				{
					effects: ['grain', 'crt'],
					screens: { grain: { strength: 2.4 }, crt: { scale: 0.5 } },
					screenReach: 'edges'
				},
				null
			],
			// A number nobody could have meant, a screen nobody has, and the one
			// pair an earlier build kept under the screen each leaves out.
			[
				{
					effects: ['grain'],
					screens: { grain: { strength: 'lots' }, nothing: { scale: 2 } },
					screen: { strength: 2, edges: true }
				},
				null
			],
			[{ effects: ['grain'], screens: 'a lot', screenReach: 'nowhere' }, null],
			// What an earlier build saved, which both painters read the same way.
			[{ theme: 'dark', accent: 'moss', font: 'opendyslexic' }, null],
			[{ theme: 'paper', scheme: GRUVBOX.slug }, GRUVBOX, 'sloppy_scheme'],
			[{ look: GRUVBOX.slug }, GRUVBOX],
			// Paint reaching for the one token another axis owns: neither painter
			// writes it, so both leave the same thing on the page.
			[
				{ look: GRUVBOX.slug },
				{ ...GRUVBOX, tokens: { ...GRUVBOX.tokens, '--border': '#504945' } }
			],
			// Paint cached for another look is not this one's, so neither painter
			// uses it and `app.css` answers for the look instead.
			[{ look: SOLARIZED.slug }, GRUVBOX],
			[{ look: 'paper', css: '.sloppy-prose h2 { letter-spacing: 0.02em }' }, null],
			// Rules that would reach the network are written by neither of them,
			// however the look spells it.
			[{ look: 'paper', css: "@import 'https://elsewhere.example/x.css';" }, null],
			[{ look: 'paper', css: 'h2 { background: url(https://elsewhere.example/p.png) }' }, null],
			[
				{
					look: 'paper',
					css: 'h2 { content: "/*"; background: url(https://elsewhere.example/p.png); content: "*/" }'
				},
				null
			],
			[
				{
					look: 'paper',
					css: 'h2 { background: image-set("https://elsewhere.example/p.png" 1x) }'
				},
				null
			],
			[{ look: 'paper', css: 'h2 { background: url("data:image/gif;base64,R0lGOD") }' }, null],
			[{ look: 'paper', css: 'x'.repeat(65537) }, null],
			// The three faces, as this build keeps them and as an earlier one kept
			// the one it had: a face offered here, a family nobody here ships, and
			// one that gives an address its column up.
			[{ look: 'paper', fonts: { ui: 'atkinson' } }, null],
			[{ look: 'paper', fonts: { ui: 'Iosevka Etoile' } }, null],
			[{ look: 'paper', fonts: { ui: 'inter', heading: 'Iosevka "Et"', mono: 'apple' } }, null],
			[{ look: 'paper', fonts: { mono: 'opendyslexic' } }, null],
			[
				{ look: 'paper', fonts: { ui: 'a face; position: fixed', mono: 'url(http://a.example)' } },
				null
			],
			[{ look: 'paper', font: 'opendyslexic' }, null]
		];
		for (const [saved, dressing, key = 'sloppy_look'] of cases) {
			localStorage.setItem('sloppy_prefs', JSON.stringify(saved));
			localStorage.removeItem('sloppy_look');
			localStorage.removeItem('sloppy_scheme');
			if (dressing !== null) localStorage.setItem(key, JSON.stringify(dressing));
			prefs.init();
			const byTheStore = stamped();
			unstamp();
			bootScript(shell)();
			expect(stamped(), JSON.stringify(saved)).toEqual(byTheStore);
		}
	});

	it('agrees with the boot script about which looks are dark', () => {
		for (const [look, dark] of [
			['paper', false],
			['graphite', true],
			['light', false],
			['dark', true],
			['contrast', false]
		] as const) {
			prefs.set('look', look);
			expect(prefs.isDark).toBe(dark);
			expect(document.documentElement.classList.contains('dark')).toBe(dark);
		}
	});

	// app.css declares `color-scheme`; `isDark` draws the `dark` class. One fact.
	it('calls a look dark the way the stylesheet does', () => {
		for (const look of BUILT_IN_LOOKS) {
			prefs.set('look', look);
			expect(prefs.isDark).toBe(stylesheetCallsDark(look));
		}
	});

	it('falls back to a default rather than trusting a value it does not know', () => {
		localStorage.setItem(
			'sloppy_prefs',
			JSON.stringify({
				look: 'Not An Id!',
				theme: 'neon',
				style: 'sketch',
				effect: 'neon',
				effects: ['neon', 7],
				screen: { strength: 9, scale: 'big', edges: 'yes' },
				screens: { grain: { strength: 9 }, nothing: { scale: 2 } },
				screenReach: 'nowhere',
				ownLook: 'Not An Id',
				fonts: { ui: 'a face; position: fixed', heading: 7 },
				css: 'x'.repeat(65_537),
				tags: 'seed',
				ground: 'graph paper',
				graph: 'not a ref',
				alsoOnCanvas: ['neither is this'],
				wallpapers: 'a picture',
				views: 'how it was read',
				seenAs: 'a reading nobody has',
				readingWidth: 'wide',
				chatWidth: 'narrow',
				chatModel: { claude_code: 'a model from later', nobody: 'opus' },
				origin: 'nowhere at all/ /'
			})
		);
		prefs.init();
		expect(prefs.current).toEqual({
			look: 'paper',
			lookName: null,
			ownLook: null,
			style: 'default',
			effects: [],
			screens: {},
			screenReach: 'everywhere',
			fonts: { ui: 'system', heading: 'system', mono: 'system' },
			css: '',
			tags: [],
			ground: 'dots',
			graph: null,
			alsoOnCanvas: [],
			wallpapers: {},
			views: {},
			seenAs: 'graph',
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
		expect(prefs.current.seenAs).toBe('graph');
		prefs.set('seenAs', 'outline');
		prefs.init();
		expect(prefs.current.seenAs).toBe('outline');
	});

	// The field this replaced was a boolean, and a reader who left the outline up
	// under the earlier build comes back to it rather than to the canvas.
	it('reads a saved walk as the outline', () => {
		localStorage.setItem('sloppy_prefs', JSON.stringify({ walking: true }));
		prefs.init();
		expect(prefs.current.seenAs).toBe('outline');
	});

	it('reads a saved walk as the outline in a folder too', () => {
		localStorage.setItem(
			'sloppy_prefs',
			JSON.stringify({ views: { [GARDEN]: { walking: true, folded: [], unfolded: [] } } })
		);
		prefs.init();
		expect(prefs.view(GARDEN)?.seenAs).toBe('outline');
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
						seenAs: 'a reading nobody has',
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
			seenAs: 'graph',
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
			prefs.set('style', 'hardline');
		}).not.toThrow();
		expect(prefs.current.style).toBe('hardline');
		vi.restoreAllMocks();
	});
});

describe('a look carried as data', () => {
	it('paints the app, and hands it back to a look app.css carries', () => {
		const root = document.documentElement;
		prefs.init();
		prefs.setLook(GRUVBOX, GRUVBOX.slug);

		expect(prefs.current.look).toBe(GRUVBOX.slug);
		expect(root.getAttribute('data-look')).toBe(GRUVBOX.slug);
		expect(painted()).toEqual(GRUVBOX.tokens);
		// Which way the ground runs is the look's own answer.
		expect(prefs.isDark).toBe(true);
		expect(root.classList.contains('dark')).toBe(true);

		prefs.setLook(null, 'paper');

		expect(prefs.current.look).toBe('paper');
		expect(painted()).toEqual({});
		expect(root.getAttribute('data-look')).toBe('paper');
		expect(prefs.isDark).toBe(false);
	});

	// DESIGN.md § "The look": a style draws its own edge on every look, so paint
	// offering the token it derives that from is not the look's to give.
	it('paints nothing another axis owns', () => {
		prefs.init();
		prefs.setLook(
			{
				slug: 'gruvbox-dark-hard',
				variant: 'dark',
				tokens: { '--background': '#1d2021', '--border': '#504945' }
			},
			'gruvbox-dark-hard'
		);

		expect(painted()).toEqual({ '--background': '#1d2021' });
		// And the copy the shells' boot scripts paint the first paint from.
		expect(JSON.parse(localStorage.getItem('sloppy_look') ?? 'null').tokens).toEqual({
			'--background': '#1d2021'
		});
	});

	// Two looks do not carry the same tokens, so what one painted has to come
	// off before the next one goes on.
	it('takes the last one off before painting another', () => {
		prefs.init();
		prefs.setLook(GRUVBOX, GRUVBOX.slug);
		prefs.setLook(SOLARIZED, SOLARIZED.slug);
		expect(painted()).toEqual(SOLARIZED.tokens);
	});

	// The inset vars live inline on <html> too, and they are not a look's to
	// clear — DESIGN.md § "The four inset vars".
	it('leaves an inline property that is not a look alone', () => {
		prefs.init();
		document.documentElement.style.setProperty('--safe-area-inset-bottom', '48px');
		prefs.setLook(GRUVBOX, GRUVBOX.slug);
		prefs.setLook(null, 'paper');
		expect(document.documentElement.style.getPropertyValue('--safe-area-inset-bottom')).toBe(
			'48px'
		);
		document.documentElement.style.removeProperty('--safe-area-inset-bottom');
	});

	// Paint in hand belongs to one look, so it stands down wherever another is
	// asked for — including from a surface that knows nothing about paint.
	it('stands down when another look is asked for', () => {
		prefs.init();
		prefs.setLook(GRUVBOX, GRUVBOX.slug);
		prefs.set('look', 'light');

		expect(prefs.current.look).toBe('light');
		expect(prefs.dressing).toBeNull();
		expect(document.documentElement.getAttribute('data-look')).toBe('light');
		expect(painted()).toEqual({});
		expect(localStorage.getItem('sloppy_look')).toBeNull();
	});

	it('carries the paint to the next visit', () => {
		prefs.init();
		prefs.setLook(GRUVBOX, GRUVBOX.slug);
		prefs.init();
		expect(prefs.current.look).toBe(GRUVBOX.slug);
		expect(painted()).toEqual(GRUVBOX.tokens);
	});

	// The id is the choice; the paint is a copy of what the collection says.
	// Losing the copy is not losing the choice — the collection resolves it again.
	it('keeps the look somebody chose when the paint is not cached', () => {
		localStorage.setItem('sloppy_prefs', JSON.stringify({ look: GRUVBOX.slug }));
		prefs.init();
		expect(prefs.current.look).toBe(GRUVBOX.slug);
		expect(prefs.dressing).toBeNull();
		expect(document.documentElement.getAttribute('data-look')).toBe(GRUVBOX.slug);
		expect(painted()).toEqual({});
	});

	it('paints custom properties, and paints nothing that is not paint', () => {
		prefs.init();
		prefs.setLook(
			{
				slug: 'tampered',
				variant: 'light',
				tokens: {
					'--background': '#fdf6e3',
					background: 'red',
					'--leak': 'url(https://elsewhere.example/pixel.png)',
					'--escapes': 'red; position: fixed',
					'--long': 'x'.repeat(200)
				} as unknown as SchemeTokens
			},
			'tampered'
		);
		expect(painted()).toEqual({ '--background': '#fdf6e3' });
		expect(document.documentElement.style.getPropertyValue('background')).toBe('');
	});
});

// DESIGN.md § "A look is a file": the rules are part of the look, and they are
// written into one element nothing else touches.
describe("the look's own rules", () => {
	it('stand in one element, are rewritten in place, and come off again', () => {
		prefs.init();
		expect(rules()).toBeNull();

		prefs.set('css', '.sloppy-prose h2 { letter-spacing: 0.02em }');
		expect(rules()).toBe('.sloppy-prose h2 { letter-spacing: 0.02em }');

		prefs.set('css', 'h2 { margin: 0 }');
		expect(document.querySelectorAll('#sloppy-look')).toHaveLength(1);
		expect(rules()).toBe('h2 { margin: 0 }');

		prefs.set('css', '');
		expect(rules()).toBeNull();
	});

	// DESIGN.md § "A look is a file": the rules stand last in `<head>`, so the
	// author's own `:root { --radius: 0 }` beats `app.css`'s instead of losing to
	// it. A cold load writes them before any stylesheet is in the head at all.
	it('stand behind the stylesheet a cold load brings in after them', () => {
		localStorage.setItem(
			'sloppy_prefs',
			JSON.stringify({ look: 'paper', css: ':root { --radius: 0 }' })
		);
		bootScript('web')();
		const appCss = document.head.appendChild(document.createElement('style'));
		prefs.init();
		expect(document.querySelectorAll('#sloppy-look')).toHaveLength(1);
		expect(rules()).toBe(':root { --radius: 0 }');
		expect(document.head.lastElementChild).toBe(document.getElementById('sloppy-look'));
		appCss.remove();
		for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.remove();
	});

	it('are put back behind a stylesheet that arrives while the app is open', async () => {
		prefs.init();
		prefs.set('css', ':root { --radius: 0 }');
		const pageCss = document.head.appendChild(document.createElement('style'));
		await vi.waitFor(() =>
			expect(document.head.lastElementChild).toBe(document.getElementById('sloppy-look'))
		);
		pageCss.remove();
	});

	it('are carried to the next visit', () => {
		prefs.init();
		prefs.set('css', 'h2 { margin: 0 }');
		prefs.init();
		expect(prefs.current.css).toBe('h2 { margin: 0 }');
		expect(rules()).toBe('h2 { margin: 0 }');
	});

	// A look arrives from somebody else, so rules that would fetch anything are
	// kept in front of whoever can take them out rather than written to the page.
	it('go unwritten where they would reach the network, and are still shown', () => {
		prefs.init();
		for (const css of [
			"@import 'https://elsewhere.example/x.css';",
			'h2 { background: url(https://elsewhere.example/pixel.png) }'
		]) {
			prefs.set('css', css);
			expect(prefs.current.css).toBe(css);
			expect(rules()).toBeNull();
		}
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
