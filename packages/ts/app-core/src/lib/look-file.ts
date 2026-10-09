/**
 * A look as a file: the one this device wears, what wearing one somebody sent
 * does, and what a file has to hold to be a look at all. DESIGN.md § "A look is
 * a file" is the doc of record for the shape and for what an absent field means.
 */

import { cssIsSafe, type Look, LOOK_NAME_MAX, LookSchema } from '@sloppy/types';
import { dressed, type Scheme, type SchemeDressing, schemes } from '@sloppy/ui';
import {
	BUILT_IN_LOOKS,
	type BuiltInLook,
	LOOK_LABELS,
	type Prefs,
	prefs
} from './stores/prefs.svelte.js';

const NOT_A_LOOK = 'That is not a look. Open one Sloppy saved, or paste one somebody sent you.';
const NOTHING_UNDER_IT =
	'This look is built on one Sloppy does not have. Ask for a look that stands on its own.';
const LOOKS_UNREAD = 'Sloppy could not read its looks just now. Try again in a moment.';

/**
 * The issue kinds `LookSchema` states in words a person can act on: a bound it
 * names, a shape it spells out, a rule it checks. Every other kind is the parser
 * saying which type it wanted, which is what {@link NOT_A_LOOK} is for.
 */
const SPOKEN: ReadonlySet<string> = new Set(['custom', 'too_big', 'too_small', 'invalid_format']);

/** What the look states itself, so `preferences` carries no second copy of any
 *  of it. */
const OF_THE_LOOK: readonly string[] = ['look', 'style', 'density', 'effect', 'fonts', 'css'];

/** What is this device's rather than this person's: the graph in front of them,
 *  the canvas beside it, the pictures under those and the Sloppy that minted
 *  every one of them mean nothing on another machine. */
const OF_THIS_DEVICE: readonly string[] = [
	'graph',
	'alsoOnCanvas',
	'wallpapers',
	'views',
	'origin'
];

/** The keys a file carries from one machine to another — everything this build
 *  keeps but those two sets, so a key added to prefs travels without being
 *  listed anywhere. */
function carried(): string[] {
	return Object.keys(prefs.current).filter(
		(key) => !OF_THE_LOOK.includes(key) && !OF_THIS_DEVICE.includes(key)
	);
}

function isBuiltIn(look: string): look is BuiltInLook {
	return (BUILT_IN_LOOKS as readonly string[]).includes(look);
}

async function schemeAt(slug: string): Promise<Scheme | null> {
	return (await schemes()).find((one) => one.slug === slug) ?? null;
}

/** What `LOOK_ID` in `@sloppy/types` bounds a look id to. */
const ID_MAX = 64;

/** A look's id from its name — the name of the file it is saved as, and where
 *  it is free, the id a look that stands on its own is worn under. */
export function lookId(name: string): string {
	const said = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+/, '')
		.slice(0, ID_MAX)
		.replace(/-+$/, '');
	return said === '' ? 'a-look' : said;
}

function countedId(said: string, n: number): string {
	const tail = `-${n}`;
	return `${said.slice(0, ID_MAX - tail.length).replace(/-+$/, '')}${tail}`;
}

/** Every id this Sloppy already answers to with a look of its own: its five,
 *  and the collection's slugs where the collection can be read. */
async function spokenFor(): Promise<ReadonlySet<string>> {
	const taken = new Set<string>(BUILT_IN_LOOKS);
	try {
		for (const one of await schemes()) taken.add(one.slug);
	} catch {
		// Sloppy's own five are the ids a palette lands visibly wrong on, and they
		// are in hand whether or not the collection arrived.
	}
	return taken;
}

/** The id a look that stands on its own is worn under: the one its name makes,
 *  counted past any look this Sloppy already answers to — DESIGN.md § "A look
 *  is a file" says what landing on one of those would do to it. */
async function ownId(name: string): Promise<string> {
	const said = lookId(name);
	const taken = await spokenFor();
	let id = said;
	for (let n = 2; taken.has(id); n++) id = countedId(said, n);
	return id;
}

/** What the look this device wears is called, and the look to lay it over again
 *  — one of Sloppy's five, or one in the collection. A look that is in neither
 *  stands on its own, so it travels as its palette and nothing under it. */
async function standing(): Promise<{ name: string; based_on?: string }> {
	const look = prefs.current.look;
	if (isBuiltIn(look)) return { name: LOOK_LABELS[look], based_on: look };
	try {
		const found = await schemeAt(look);
		if (found === null) return { name: look };
		return { name: found.name.trim().slice(0, LOOK_NAME_MAX) || look, based_on: look };
	} catch {
		// The collection could not be read, which says nothing about whether it
		// carries this look — so the file keeps it, rather than turning a look of
		// the collection's into one standing on its own.
		return { name: look, based_on: look };
	}
}

/** The look as this device wears it, with `preferences` only where asked — the
 *  look alone is what one person sends another. */
export async function lookNow(withPreferences: boolean): Promise<Look> {
	const held = prefs.current;
	const look: Look = {
		...(await standing()),
		style: held.style,
		density: held.density,
		effect: held.effect,
		fonts: { ...held.fonts }
	};
	const paint = prefs.dressing?.tokens;
	if (paint !== undefined && Object.keys(paint).length > 0) look.palette = { ...paint };
	if (held.css !== '') look.css = held.css;
	if (withPreferences) {
		const taking = carried();
		look.preferences = Object.fromEntries(
			Object.entries(held).filter(([key]) => taking.includes(key))
		);
	}
	return look;
}

/** The paint the named look is laid over: null where Sloppy writes it itself,
 *  and a line for a person where there is nothing to lay it on. */
async function laidOver(basedOn: string): Promise<SchemeDressing | null | string> {
	if (isBuiltIn(basedOn)) return null;
	let found: Scheme | null;
	try {
		found = await schemeAt(basedOn);
	} catch {
		return LOOKS_UNREAD;
	}
	return (found === null ? null : dressed(found)) ?? NOTHING_UNDER_IT;
}

/** Wear a look: what it holds is applied and what it leaves out is left alone.
 *  Null is a look now on, and anything else is the one line saying why not. */
export async function wearLook(look: Look): Promise<string | null> {
	if (look.css !== undefined) {
		const reaching = cssIsSafe(look.css);
		if (reaching !== null) return reaching;
	}
	const palette = paintOf(look);
	const under = look.based_on === undefined ? null : await laidOver(look.based_on);
	if (typeof under === 'string') return under;
	const own = look.based_on === undefined && palette !== null ? await ownId(look.name) : null;
	wear(look, palette, under, own);
	return null;
}

/** The paint the look lays over whatever is underneath, or null where it names
 *  none. */
function paintOf(look: Look): NonNullable<Look['palette']> | null {
	return look.palette !== undefined && Object.keys(look.palette).length > 0 ? look.palette : null;
}

/** Everything the look states, with nothing awaited between: a file lands as
 *  one change rather than as a run of them. */
function wear(
	look: Look,
	palette: NonNullable<Look['palette']> | null,
	under: SchemeDressing | null,
	own: string | null
): void {
	if (look.based_on !== undefined) {
		prefs.setLook(under, look.based_on);
		if (palette !== null) {
			// Which way the ground runs is the look underneath's answer, so it is
			// read back once that look is standing rather than guessed at here.
			prefs.setLook(
				{
					slug: look.based_on,
					variant: prefs.isDark ? 'dark' : 'light',
					tokens: { ...under?.tokens, ...palette }
				},
				look.based_on
			);
		}
	} else if (palette !== null && own !== null) {
		// A look that stands on its own stands on the app's own colours, which
		// are a light ground — DESIGN.md § "A look is a file".
		prefs.setLook({ slug: own, variant: 'light', tokens: palette }, own);
	}
	if (look.style !== undefined) prefs.set('style', look.style);
	if (look.density !== undefined) prefs.set('density', look.density);
	if (look.effect !== undefined) prefs.set('effect', look.effect);
	if (look.fonts !== undefined) prefs.set('fonts', faces(look.fonts));
	if (look.css !== undefined) prefs.set('css', look.css);
	if (look.preferences !== undefined) moveIn(look.preferences);
}

/** The three faces with the ones the look names laid over them. */
function faces(named: NonNullable<Look['fonts']>): Prefs['fonts'] {
	const held = { ...prefs.current.fonts };
	for (const role of ['ui', 'heading', 'mono'] as const) {
		const face = named[role];
		if (face !== undefined) held[role] = face;
	}
	return held;
}

/** The rest of how somebody keeps Sloppy, from a file. A key this build does
 *  not keep is left where it is, and every value arrived from outside — so the
 *  store reads its own storage again afterwards and holds each of them to what
 *  it holds a saved one to. */
function moveIn(held: Record<string, unknown>): void {
	const taking = carried();
	for (const [key, value] of Object.entries(held)) {
		if (taking.includes(key)) prefs.set(key as keyof Prefs, value as never);
	}
	prefs.init();
}

/** A look from what a file or the clipboard holds, or the one line to put in
 *  front of whoever handed it over. */
export function readLook(text: string): Look | string {
	let held: unknown;
	try {
		held = JSON.parse(text) as unknown;
	} catch {
		return NOT_A_LOOK;
	}
	const read = LookSchema.safeParse(held);
	if (read.success) return read.data;
	const spoken = read.error.issues.find((one) => SPOKEN.has(one.code) && one.path.length > 0);
	return spoken?.message ?? NOT_A_LOOK;
}
