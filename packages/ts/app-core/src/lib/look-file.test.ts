// A look as a file: what this device writes out, what wearing one somebody
// sent does, and what a file has to hold to be a look — DESIGN.md § "A look is
// a file".

import { LOOK_CSS_MAX, LOOK_ID } from '@sloppy/types';
import { dressed, schemes } from '@sloppy/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lookId, lookNow, readLook, rulesWithheld, wearLook } from './look-file.js';
import { BUILT_IN_LOOKS, prefs } from './stores/prefs.svelte.js';

/** A scheme the collection carries, which it runs dark. */
const NORD = 'base16-nord';

/** Prefs as they stand, as JSON — the shape they are persisted in, so two of
 *  them compare without the store's own proxies in the way. */
function held(): Record<string, unknown> {
	return JSON.parse(JSON.stringify(prefs.current)) as Record<string, unknown>;
}

async function wearTheCollection(slug: string): Promise<void> {
	const scheme = (await schemes()).find((one) => one.slug === slug);
	if (!scheme) throw new Error(`the collection has no ${slug}`);
	const dressing = dressed(scheme);
	if (!dressing) throw new Error(`${slug} is not a look the app can wear`);
	prefs.setLook(dressing, slug);
}

/** A device somebody has kept Sloppy on for a while: every axis off its
 *  default, and some of the rest moved too. */
function aDeviceLivedOn(): void {
	prefs.set('style', 'hardline');
	prefs.set('density', 'compact');
	prefs.set('effects', ['grain', 'crt']);
	prefs.set('screen', { strength: 1.6, scale: 0.75, edges: true });
	prefs.set('fonts', { ui: 'Inter', heading: 'Iosevka Etoile', mono: 'JetBrains Mono' });
	prefs.set('css', '.sloppy-prose h2 { letter-spacing: .02em }');
	prefs.set('tagOrder', 'name');
	prefs.set('autosave', true);
	prefs.set('deskNavOpen', false);
}

beforeEach(() => {
	localStorage.clear();
	vi.stubGlobal('matchMedia', (query: string) => ({
		matches: false,
		media: query,
		addEventListener: () => {},
		removeEventListener: () => {}
	}));
	prefs.init();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('the look this device wears', () => {
	it("is named for one of Sloppy's own, and carries every axis", async () => {
		aDeviceLivedOn();
		const look = await lookNow(false);
		expect(look).toMatchObject({
			name: 'Paper',
			based_on: 'paper',
			style: 'hardline',
			density: 'compact',
			effect: ['grain', 'crt'],
			screen: { strength: 1.6, scale: 0.75, edges: true },
			fonts: { ui: 'Inter', heading: 'Iosevka Etoile', mono: 'JetBrains Mono' },
			css: '.sloppy-prose h2 { letter-spacing: .02em }'
		});
		expect(look.palette).toBeUndefined();
		expect(look.preferences).toBeUndefined();
	});

	it('is named by the collection, and carries its paint, where it is one of those', async () => {
		await wearTheCollection(NORD);
		const look = await lookNow(false);
		expect(look.name).toBe('Nord');
		expect(look.based_on).toBe(NORD);
		expect(look.palette?.['--background']).toBe(prefs.dressing?.tokens['--background']);
	});

	it('carries the rest of how Sloppy is kept only where that is asked for', async () => {
		aDeviceLivedOn();
		expect((await lookNow(true)).preferences).toMatchObject({
			tagOrder: 'name',
			autosave: true,
			deskNavOpen: false
		});
	});

	it('leaves the graph in front of somebody and the Sloppy it came from out of it', async () => {
		prefs.set('origin', 'https://elsewhere.example');
		const moving = await lookNow(true);
		expect(moving.preferences).not.toHaveProperty('origin');
		expect(moving.preferences).not.toHaveProperty('graph');
		expect(moving.preferences).not.toHaveProperty('views');
	});

	// The selection lighting the graph is a question asked of the graph in front
	// of them — DESIGN.md § Persistence.
	it('leaves the question lighting the graph out of it too', async () => {
		prefs.set('tags', ['biology', 'seed']);
		const moving = await lookNow(true);
		expect(moving.preferences).not.toHaveProperty('tags');
		expect(prefs.current.tags).toEqual(['biology', 'seed']);
	});

	// A file Sloppy writes is one Sloppy reads: rules that reach the web are
	// refused on the way in, so they are left out on the way out, and stay in
	// Settings where they can be fixed.
	it('leaves rules that reach the web out of the file, and keeps them to fix', async () => {
		const reaching = 'h2 { background: url(https://elsewhere.example/p.png) }';
		prefs.set('css', reaching);
		expect(rulesWithheld(reaching)).toBe(true);

		const look = await lookNow(false);

		expect(look.css).toBeUndefined();
		expect(prefs.current.css).toBe(reaching);
		expect(readLook(JSON.stringify(look))).toMatchObject({ name: 'Paper' });
	});

	it('carries the rules a look can carry', async () => {
		prefs.set('css', '.a { color: red }');
		expect(rulesWithheld('.a { color: red }')).toBe(false);
		expect((await lookNow(false)).css).toBe('.a { color: red }');
	});

	it('states nothing twice: what the look says is not in the settings beside it', async () => {
		const moving = await lookNow(true);
		for (const key of ['look', 'ownLook', 'style', 'density', 'effects', 'screen', 'fonts', 'css'])
			expect(moving.preferences).not.toHaveProperty(key);
	});
});

describe('wearing one', () => {
	it('leaves every setting as it was, worn straight back', async () => {
		aDeviceLivedOn();
		const file = await lookNow(true);
		const before = held();
		expect(await wearLook(file)).toBeNull();
		expect(held()).toEqual(before);
	});

	it('leaves every setting as it was for a look out of the collection too', async () => {
		aDeviceLivedOn();
		await wearTheCollection(NORD);
		const file = await lookNow(true);
		const before = held();
		const paint = { ...prefs.dressing?.tokens };
		expect(await wearLook(file)).toBeNull();
		expect(held()).toEqual(before);
		expect({ ...prefs.dressing?.tokens }).toEqual(paint);
	});

	it('leaves a look that stands on its own exactly as it stands, worn straight back', async () => {
		expect(
			await wearLook({ name: 'Midnight Ink', palette: { '--background': 'oklch(.97 0 0)' } })
		).toBeNull();
		const file = await lookNow(false);
		expect(file.based_on).toBeUndefined();
		const before = held();
		const paint = { ...prefs.dressing?.tokens };
		expect(await wearLook(file)).toBeNull();
		expect(held()).toEqual(before);
		expect({ ...prefs.dressing?.tokens }).toEqual(paint);
		expect(prefs.dressing?.variant).toBe('light');
	});

	it('changes only the rules where that is all the look holds', async () => {
		aDeviceLivedOn();
		const before = held();
		expect(await wearLook({ name: 'Just a rule', css: '.a { color: red }' })).toBeNull();
		expect(held()).toEqual({ ...before, css: '.a { color: red }' });
	});

	it("lays a palette over the look it names, and stands on that look's ground", async () => {
		expect(
			await wearLook({
				name: 'Midnight Ink',
				based_on: 'graphite',
				palette: { '--background': 'oklch(.17 .02 265)' }
			})
		).toBeNull();
		expect(prefs.current.look).toBe('graphite');
		expect(prefs.dressing?.tokens['--background']).toBe('oklch(.17 .02 265)');
		expect(prefs.isDark).toBe(true);
	});

	it('wears a look that stands on its own under a name of its own, on a light ground', async () => {
		expect(
			await wearLook({ name: 'Midnight Ink', palette: { '--background': 'oklch(.97 0 0)' } })
		).toBeNull();
		expect(prefs.current.look).toBe('midnight-ink');
		expect(prefs.isDark).toBe(false);
		expect(document.documentElement.getAttribute('data-look')).toBe('midnight-ink');
	});

	it('turns down a look built on one it does not have, and changes nothing', async () => {
		aDeviceLivedOn();
		const before = held();
		const why = await wearLook({
			name: "Somebody else's",
			based_on: 'nothing-here',
			style: 'pixel'
		});
		expect(why).toContain('does not have');
		expect(held()).toEqual(before);
	});

	it('moves the rest of how Sloppy is kept where the look carries it', async () => {
		expect(prefs.current.tagOrder).toBe('count');
		expect(
			await wearLook({ name: 'Mine', preferences: { tagOrder: 'name', autosaveMinutes: 15 } })
		).toBeNull();
		expect(prefs.current.tagOrder).toBe('name');
		expect(prefs.current.autosaveMinutes).toBe(15);
	});

	it('leaves them alone where it does not', async () => {
		prefs.set('tagOrder', 'name');
		expect(await wearLook({ name: 'Mine', style: 'bevel' })).toBeNull();
		expect(prefs.current.tagOrder).toBe('name');
		expect(prefs.current.style).toBe('bevel');
	});

	it('holds what it moves to what the store holds a saved setting to', async () => {
		expect(
			await wearLook({
				name: 'Mine',
				preferences: { tagOrder: 'whatever', autosaveMinutes: 999, graph: 'did:syr:x/nope' }
			})
		).toBeNull();
		expect(prefs.current.tagOrder).toBe('count');
		expect(prefs.current.autosaveMinutes).toBe(5);
		expect(prefs.current.graph).toBeNull();
	});

	// A look written before several screens could be on at once names one, and
	// is still the look it was.
	it('wears the one screen a look written with one names', async () => {
		aDeviceLivedOn();
		expect(await wearLook({ name: 'Mine', effect: 'dots' })).toBeNull();
		expect(prefs.current.effects).toEqual(['dots']);
		expect(await wearLook({ name: 'Mine', effect: 'none' })).toBeNull();
		expect(prefs.current.effects).toEqual([]);
	});

	it('wears every screen a look names, in the order they are drawn', async () => {
		expect(await wearLook({ name: 'Mine', effect: ['crt', 'dots'] })).toBeNull();
		expect(prefs.current.effects).toEqual(['dots', 'crt']);
	});

	// What a look leaves out of its screen is the screen at rest: a file saying
	// grain and nothing else is read the same on a device somebody had turned
	// every number up on as on one they had not.
	it('draws the screen at rest where the look says only part of it', async () => {
		aDeviceLivedOn();
		expect(await wearLook({ name: 'Mine', effect: 'grain', screen: { scale: 2 } })).toBeNull();
		expect(prefs.current.screen).toEqual({ strength: 1, scale: 2, edges: false });
	});

	it('leaves the screen alone where the look says nothing about it', async () => {
		aDeviceLivedOn();
		expect(await wearLook({ name: 'Mine', effect: 'grain' })).toBeNull();
		expect(prefs.current.screen).toEqual({ strength: 1.6, scale: 0.75, edges: true });
	});

	it('takes only the faces the look names', async () => {
		prefs.set('fonts', { ui: 'Inter', heading: 'Inter', mono: 'JetBrains Mono' });
		expect(await wearLook({ name: 'Mine', fonts: { heading: 'Iosevka Etoile' } })).toBeNull();
		expect(prefs.current.fonts).toEqual({
			ui: 'Inter',
			heading: 'Iosevka Etoile',
			mono: 'JetBrains Mono'
		});
	});

	it('leaves a role alone where the look names no face it can be set in', async () => {
		prefs.set('fonts', { ui: 'Inter', heading: 'Inter', mono: 'JetBrains Mono' });
		expect(
			await wearLook({ name: 'Mine', fonts: { ui: 'url(http://elsewhere/a.woff2)' } })
		).toBeNull();
		expect(prefs.current.fonts.ui).toBe('Inter');
		expect(document.documentElement.style.getPropertyValue('--font-sans')).toContain('Inter');
	});

	it.each(BUILT_IN_LOOKS)(
		"wears one named for Sloppy's own %s under an id of its own, not that look's",
		async (built) => {
			expect(lookId(built)).toBe(built);
			expect(
				await wearLook({ name: built, palette: { '--background': 'oklch(.97 0 0)' } })
			).toBeNull();
			expect(prefs.current.look).not.toBe(built);
			expect(prefs.current.look).toMatch(LOOK_ID);
			expect(document.documentElement.getAttribute('data-look')).toBe(prefs.current.look);
			expect(prefs.dressing?.tokens['--background']).toBe('oklch(.97 0 0)');
			// The ground under it is the app's own light one, which is what the look
			// said by naming nothing under itself.
			expect(prefs.isDark).toBe(false);
			expect(document.documentElement.classList.contains('dark')).toBe(false);
			expect((await lookNow(false)).based_on).toBeUndefined();
		}
	);

	it('wears one named for a scheme in the collection under an id of its own too', async () => {
		expect(lookId('Base16 Nord')).toBe(NORD);
		expect(
			await wearLook({ name: 'Base16 Nord', palette: { '--background': 'oklch(.97 0 0)' } })
		).toBeNull();
		expect(prefs.current.look).not.toBe(NORD);
		expect(prefs.current.look).toMatch(LOOK_ID);
		// A copy of it still stands on its own, rather than naming that scheme as
		// what it is built on.
		expect((await lookNow(false)).based_on).toBeUndefined();
	});

	it('wears one under the same id again, worn straight back', async () => {
		expect(
			await wearLook({ name: 'Dark', palette: { '--background': 'oklch(.97 0 0)' } })
		).toBeNull();
		const id = prefs.current.look;
		const file = await lookNow(false);
		expect(await wearLook(file)).toBeNull();
		expect(prefs.current.look).toBe(id);
	});

	// Which look is one of somebody's own is a thing no collection can answer, so
	// wearing one says so and wearing any other takes it back.
	it('says which look is theirs, and stops saying it when another goes on', async () => {
		expect(
			await wearLook({ name: 'Midnight Ink', palette: { '--background': 'oklch(.97 0 0)' } })
		).toBeNull();
		expect(prefs.current.ownLook).toBe(prefs.current.look);

		await wearTheCollection(NORD);
		expect(prefs.current.ownLook).toBeNull();

		expect(await wearLook({ name: 'Paper', based_on: 'paper' })).toBeNull();
		expect(prefs.current.ownLook).toBeNull();
	});

	// A browser told to block site data throws on the write, and then memory is
	// all there is: re-reading storage would hand this person the defaults
	// instead of the look they just opened.
	it('keeps what a look moved in where the device will not write it down', async () => {
		const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('site data is blocked');
		});
		try {
			expect(
				await wearLook({
					name: 'Mine',
					style: 'bevel',
					preferences: { tagOrder: 'name', autosaveMinutes: 15 }
				})
			).toBeNull();
			expect(prefs.current.style).toBe('bevel');
			expect(prefs.current.tagOrder).toBe('name');
			expect(prefs.current.autosaveMinutes).toBe(15);
		} finally {
			blocked.mockRestore();
		}
	});

	it('turns down rules that would reach the web, and leaves the ones standing', async () => {
		prefs.set('css', '.a { color: red }');
		const why = await wearLook({ name: 'Phoning home', css: '@import url(https://x.test/a.css)' });
		expect(why).toContain('cannot load anything from the web');
		expect(prefs.current.css).toBe('.a { color: red }');
	});
});

// A look arrives under a name of its own, and that name is what the next copy
// of it carries — DESIGN.md § "A look is a file".
describe('the name a look arrived with', () => {
	it('outlives the name of the look it was laid over', async () => {
		expect(
			await wearLook({
				name: 'Midnight Ink',
				based_on: 'graphite',
				palette: { '--background': 'oklch(.17 .02 265)' }
			})
		).toBeNull();
		expect((await lookNow(false)).name).toBe('Midnight Ink');

		prefs.init();

		expect((await lookNow(false)).name).toBe('Midnight Ink');
		expect((await lookNow(false)).based_on).toBe('graphite');
	});

	it('is what a look of their own is called, rather than the id it is worn under', async () => {
		expect(
			await wearLook({ name: 'Midnight Ink', palette: { '--background': 'oklch(.97 0 0)' } })
		).toBeNull();
		expect(prefs.current.look).toBe('midnight-ink');
		expect((await lookNow(false)).name).toBe('Midnight Ink');

		prefs.init();

		expect((await lookNow(false)).name).toBe('Midnight Ink');
	});

	it('is kept only where it is a name neither Sloppy nor the collection has', async () => {
		expect(await wearLook({ name: 'Graphite', based_on: 'graphite' })).toBeNull();
		expect(prefs.current.lookName).toBeNull();

		expect(await wearLook({ name: 'Nord', based_on: NORD })).toBeNull();
		expect(prefs.current.lookName).toBeNull();
	});

	it('goes when another look does', async () => {
		expect(await wearLook({ name: 'Midnight Ink', based_on: 'graphite' })).toBeNull();
		prefs.setLook(null, 'light');
		expect(prefs.current.lookName).toBeNull();
		expect((await lookNow(false)).name).toBe('Light');
	});

	// A file naming no palette and nothing under it says nothing about which
	// look is on, so it leaves the one that is standing — its name with it.
	it('stands where a look changes only the rules', async () => {
		expect(
			await wearLook({ name: 'Midnight Ink', palette: { '--background': 'oklch(.97 0 0)' } })
		).toBeNull();
		expect(await wearLook({ name: 'Tighter headings', css: '.a { color: red }' })).toBeNull();
		expect((await lookNow(false)).name).toBe('Midnight Ink');
	});
});

describe('reading one', () => {
	it('turns down what is not JSON at all in one line', () => {
		expect(readLook('not a look')).toBe(
			'That is not a look. Open one Sloppy saved, or paste one somebody sent you.'
		);
	});

	it('turns down JSON that is not a look, in the same line', () => {
		expect(readLook('{"theme":"dark"}')).toContain('That is not a look');
		expect(readLook('[]')).toContain('That is not a look');
		expect(readLook('{"name":"Mine","style":"neon"}')).toContain('That is not a look');
	});

	it('says a look cannot reach the web, for rules and for paint alike', () => {
		expect(readLook('{"name":"A","css":"@import \\"x.css\\""}')).toContain(
			'cannot load anything from the web'
		);
		expect(readLook('{"name":"A","css":".a{background:url(https://x.test/a.png)}"}')).toContain(
			'cannot load anything from the web'
		);
		expect(
			readLook('{"name":"A","palette":{"--background":"url(https://x.test/a.png)"}}')
		).toContain('cannot load anything from the web');
	});

	it("says when a look's own rules run longer than one can carry", () => {
		const long = JSON.stringify({ name: 'Long', css: 'a'.repeat(LOOK_CSS_MAX + 1) });
		expect(readLook(long)).toContain('too long to keep');
	});

	it('reads a look, and drops what it does not know', () => {
		const read = readLook('{"name":"Midnight Ink","based_on":"graphite","neon":true}');
		expect(read).toEqual({ name: 'Midnight Ink', based_on: 'graphite' });
	});
});

describe("a look's id", () => {
	it('is its name, as an id', () => {
		expect(lookId('Midnight Ink')).toBe('midnight-ink');
		expect(lookId('  Paper & Ink!  ')).toBe('paper-ink');
	});

	it('is something rather than nothing where the name is all punctuation', () => {
		expect(lookId('✦✦✦')).toBe('a-look');
	});

	it('is an id a look can be worn under, however long the name', () => {
		expect(lookId('Midnight '.repeat(40))).toMatch(LOOK_ID);
		expect(lookId('x'.repeat(200))).toMatch(LOOK_ID);
	});
});
