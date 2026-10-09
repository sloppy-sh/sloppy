/**
 * The look of the app and the tags it opens on — DESIGN.md § Persistence — and
 * which Sloppy this device talks to — docs/ARCHITECTURE.md § "Deployment
 * modes". One writer for `sloppy_prefs` and for `sloppy_look`, and the only
 * code that sets the axis attributes on `<html>`, or writes the look's own
 * rules, after first paint.
 *
 * The shells' `app.html` boot scripts read the SAME two keys to paint the first
 * paint, so the keys, the field names, the first-visit defaults, the dark roster
 * and the bounds a dressing's tokens and a look's own rules are held to are all
 * shared with them. Changing any of those means changing both boot scripts in
 * the same commit.
 */

import { GRAPH_GROUNDS, type GraphGround } from '@sloppy/graph';
import { UNDRESSED_TOKENS, type SchemeDressing } from '@sloppy/ui';
import {
	CHAT_AGENTS,
	CHAT_MODEL_MAX,
	type ChatAgent,
	cssIsSafe,
	DENSITIES,
	type Density,
	EFFECTS,
	type Effect,
	FACE_NAME_MAX,
	LOOK_CSS_MAX,
	LOOK_ID,
	type OwnedRef,
	OwnedRefSchema,
	STYLES,
	type Style,
	type Tag,
	TagSchema
} from '@sloppy/types';
import { sanitizeWallpapers, type WallpaperPrefs } from '../wallpaper.js';

export { DENSITIES, EFFECTS, STYLES } from '@sloppy/types';
export type { Density, Effect, Style } from '@sloppy/types';

/** The looks Sloppy ships. Every other look is a palette carried as data, so
 *  {@link Prefs.look} is a plain string — DESIGN.md § "The look". */
export type BuiltInLook = 'paper' | 'graphite' | 'light' | 'dark' | 'contrast';
/** The faces this build offers. `system` is the role's own, and every other
 *  face a look can ask for is a family by name — DESIGN.md § Typography. */
export type Face = 'system' | 'inter' | 'atkinson' | 'opendyslexic' | 'apple';
/** The three things a face is chosen for. */
export type FaceRole = keyof Prefs['fonts'];

/**
 * How one folder was last being read, for the tab that comes back to it —
 * docs/ARCHITECTURE.md § "Several folders open at once". `graph`,
 * `alsoOnCanvas`, `tags` and `walking` are on the terms {@link Prefs} states
 * for them; the rest is what the surface reading the folder was holding.
 */
export interface FolderView {
	graph: OwnedRef | null;
	alsoOnCanvas: OwnedRef[];
	tags: Tag[];
	walking: boolean;
	/** The note open beside the graph. ABSENT is a folder left with none. */
	note?: OwnedRef;
	/** Every note open on the reading surface, in the order they were opened.
	 *  ABSENT is a folder left with none. */
	notes?: OwnedRef[];
	/** The branches the reader folded on the canvas, and the ones they opened in
	 *  the tree — two answers, because one surface draws every note and folds
	 *  what is folded while the other draws none and opens what is opened. */
	folded: OwnedRef[];
	unfolded: OwnedRef[];
	/** Where the canvas stood and how close, in world coordinates. ABSENT is a
	 *  folder whose canvas frames itself when it opens. */
	viewport?: { x: number; y: number; scale: number };
}

export interface Prefs {
	/** The whole palette the app wears: a {@link BuiltInLook}, or a look carried
	 *  as data by its id — DESIGN.md § "The look". */
	look: string;
	style: Style;
	/** What the screen itself is drawn like over everything else — DESIGN.md
	 *  § "The look". */
	effect: Effect;
	/** The faces the app, its headings and its code are set in — DESIGN.md
	 *  § Typography. Each is one this build offers or a family somebody named. */
	fonts: { ui: string; heading: string; mono: string };
	/** Rules of the person's own, part of the look and applied over everything
	 *  else — DESIGN.md § "A look is a file". Empty is a look with none. */
	css: string;
	/** The tags the graph is lit by, in SELECTION order — that order hands out
	 *  the hues, so sorting it would repaint the reader's question. Empty is the
	 *  monochrome graph DESIGN.md § Hue calls for when nothing has been asked. */
	tags: Tag[];
	/** The paper the graph is drawn on — DESIGN.md § "The ground". */
	ground: GraphGround;
	/** The graph the reader is in. Null is the one they started with, which is
	 *  also what a ref belonging to somebody else falls back to. */
	graph: OwnedRef | null;
	/** The graphs standing on the canvas beside that one, in the order they went
	 *  up — DESIGN.md § "Several graphs on one canvas". */
	alsoOnCanvas: OwnedRef[];
	/** The picture behind that paper, per graph — DESIGN.md § "The wallpaper".
	 *  A graph with no entry has none. */
	wallpapers: Record<OwnedRef, WallpaperPrefs>;
	/** How each folder was last being read, by its root, so a tab comes back as
	 *  it was left — DESIGN.md § Persistence. A folder with no entry starts
	 *  clean. */
	views: Record<string, FolderView>;
	/** Whether the graph is read as a walk through the notes rather than drawn on
	 *  the canvas — DESIGN.md § Persistence. */
	walking: boolean;
	/** Whether the app is keeping a record of what it does, for somebody about
	 *  to say what went wrong — `stores/what-happened.svelte.ts`. */
	recordsWhatHappens: boolean;
	/** How much room the reader has taken for a note docked beside the graph, in
	 *  px. Null is the width it opens at, and a number from a wider window is
	 *  still safe to hand over: the surface bounds it against the window it is
	 *  actually in. */
	readingWidth: number | null;
	/** How much room the reader has taken for the chat docked beside the graph,
	 *  in px, on the same terms as {@link Prefs.readingWidth}. */
	chatWidth: number | null;
	/** Whether a docked note fills the page — the focused reading — rather than
	 *  standing beside the graph. Kept, like the room it takes. */
	readingFull: boolean;
	/** How close everything is drawn — DESIGN.md § Layout. `auto` is what this
	 *  device is: closer where a mouse is the only pointer. */
	density: Density;
	/** Whether a version is kept while somebody writes. Off until asked for:
	 *  nothing about somebody's own history changes shape on its own. */
	autosave: boolean;
	/** How long between them, in minutes. */
	autosaveMinutes: number;
	/** Whether the column beside the graph on a desk stands open or as an icon
	 *  rail — DESIGN.md § Layout. */
	deskNavOpen: boolean;
	/** How the tags down that column are laid out. */
	tagOrder: 'count' | 'name';
	/** Which groups of that column stand open. Both may, and they share what
	 *  it has left. */
	columnGroups: { history: boolean; tags: boolean };
	/** Whether Sloppy offers to work with an assistant at all. Off is the app
	 *  without one, and nothing about one is put in front of anybody. */
	aiOffered: boolean;
	/** Which agent answers, where this device reaches more than one. Null is
	 *  whichever it reaches first. */
	chatAgent: ChatAgent | null;
	/** Which model each agent is asked to answer with, in that agent's own
	 *  spelling. **An agent with no entry is one nobody has chosen for**, which
	 *  is what it answers with on its own. */
	chatModel: Partial<Record<ChatAgent, string>>;
	/** Whether a chat goes on answering in a tab somebody has left. Off, it
	 *  waits for them to come back. */
	chatInBackground: boolean;
	/** Whether the assistant may look things up on the web while it answers.
	 *  On until somebody turns it off. */
	chatReachesWeb: boolean;
	/** The Sloppy this device talks to, as an origin — docs/ARCHITECTURE.md
	 *  § "Deployment modes". Null is the one the app came with, which is what
	 *  the shell names. */
	origin: string | null;
}

const KEY = 'sloppy_prefs';
/** The look's paint, where it is carried as data — one cached copy, so the
 *  first paint and every later one agree. */
const LOOK_KEY = 'sloppy_look';
/** Where an earlier build cached the same thing. Read so a look chosen then
 *  paints the first paint of this one too. */
const WAS_LOOK_KEY = 'sloppy_scheme';
/** The one element the look's own rules are written into. */
const LOOK_RULES = 'sloppy-look';
const DARK_LOOKS: readonly string[] = ['graphite', 'dark'];

export const LOOK_LABELS: Record<BuiltInLook, string> = {
	paper: 'Paper',
	graphite: 'Graphite',
	light: 'Light',
	dark: 'Dark',
	contrast: 'High contrast'
};
export const STYLE_LABELS: Record<Style, string> = {
	default: 'Default',
	hardline: 'Hardline',
	bevel: 'Bevel',
	terminal: 'Terminal',
	pixel: 'Pixel'
};
export const EFFECT_LABELS: Record<Effect, string> = {
	none: 'Plain',
	crt: 'CRT'
};
export const FACE_LABELS: Record<Face, string> = {
	system: 'Default',
	inter: 'Inter',
	atkinson: 'Atkinson Hyperlegible',
	opendyslexic: 'OpenDyslexic',
	apple: "Your device's face"
};
export const DENSITY_LABELS: Record<Density, string> = {
	auto: 'What this device is',
	comfortable: 'Comfortable',
	compact: 'Compact'
};

export const BUILT_IN_LOOKS = Object.keys(LOOK_LABELS) as BuiltInLook[];
export const FACES = Object.keys(FACE_LABELS) as Face[];

/**
 * What a face this build offers asks for: the families it names where a role is
 * drawn proportionally and where it is drawn to one width, and whether it can
 * hold its figures to one column. `system` is absent because the role keeps the
 * stack `app.css` gives it.
 */
const FACE_FAMILIES: Record<
	Exclude<Face, 'system'>,
	{ proportional: string; monospaced: string; oneWidthFigures: boolean }
> = {
	inter: { proportional: "'Inter'", monospaced: "'Inter'", oneWidthFigures: true },
	atkinson: {
		proportional: "'Atkinson Hyperlegible'",
		monospaced: "'Atkinson Hyperlegible'",
		oneWidthFigures: false
	},
	opendyslexic: {
		proportional: "'OpenDyslexic'",
		monospaced: "'OpenDyslexic'",
		oneWidthFigures: false
	},
	apple: {
		proportional: '-apple-system, BlinkMacSystemFont, system-ui',
		monospaced: 'ui-monospace, SFMono-Regular, Menlo',
		oneWidthFigures: true
	}
};

/** The token each role is read from, and the stack a face is laid over there —
 *  which for a heading is the app's own face, the one that role already had. */
const FACE_TOKENS: Record<FaceRole, { token: string; under: string }> = {
	ui: { token: '--font-sans', under: 'var(--font-proportional)' },
	heading: { token: '--font-heading', under: 'var(--font-sans)' },
	mono: { token: '--font-mono', under: 'var(--font-monospaced)' }
};

/** The three, in the order they are offered. */
export const FACE_ROLES = Object.keys(FACE_TOKENS) as FaceRole[];

/** A name is written into a declaration of its own, so anything that could end
 *  that declaration, or reach off the device from inside it, is not one. */
const NOT_A_FACE = /[;{}]|url\(|\p{Cc}/iu;

/** Whether a family somebody typed is the name of a face at all. The field asks
 *  before the name is kept, so a refusal is a line somebody can act on rather
 *  than a face that silently did not take. */
export function namesAFace(family: string): boolean {
	const named = family.trim();
	return named !== '' && named.length <= FACE_NAME_MAX && !NOT_A_FACE.test(named);
}

function shippedFace(face: string): (typeof FACE_FAMILIES)[Exclude<Face, 'system'>] | null {
	return Object.hasOwn(FACE_FAMILIES, face) ? FACE_FAMILIES[face as Exclude<Face, 'system'>] : null;
}

/** A family as the person typed it, as a CSS string — a family name is not an
 *  identifier, and a quote or a backslash inside one ends the string if it is
 *  not escaped. */
function quoted(family: string): string {
	return `"${family.replace(/[\\"]/g, '\\$&')}"`;
}

/**
 * What a role's face comes to, or null where the role keeps the stack `app.css`
 * gives it. A face is a name rather than a rule: the family is used if the
 * machine has it, and the role's own stack stands behind it so a look asking
 * for a face this build does not ship still reads — DESIGN.md § Typography.
 */
function faceStack(role: FaceRole, face: string): string | null {
	// Asked again here rather than on the way in alone: this is the one place a
	// name reaches a declaration, and a look applied to the standing prefs has
	// not been through `init()`.
	if (face === 'system' || !namesAFace(face)) return null;
	const shipped = shippedFace(face);
	const asked = shipped
		? role === 'mono'
			? shipped.monospaced
			: shipped.proportional
		: quoted(face);
	return `${asked}, ${FACE_TOKENS[role].under}`;
}

/** How long between versions kept while writing, in minutes. */
export const AUTOSAVE_MINUTES = [2, 5, 15, 30] as const;

/**
 * Whether this device is one where everything can be drawn closer: a mouse and
 * nothing else. A screen somebody might reach for is drawn for a finger,
 * whatever else is plugged in. **These two queries are the whole of what a
 * webview can honestly read about it** — DESIGN.md § Layout.
 */
function drawnForAMouse(): boolean {
	try {
		return matchMedia('(pointer: fine)').matches && !matchMedia('(any-pointer: coarse)').matches;
	} catch {
		return false;
	}
}

/** Which of the two the setting comes to, for the attribute to carry. */
export function densityNow(density: Density): Exclude<Density, 'auto'> {
	if (density !== 'auto') return density;
	return drawnForAMouse() ? 'compact' : 'comfortable';
}

function systemPrefersDark(): boolean {
	try {
		return matchMedia('(prefers-color-scheme: dark)').matches;
	} catch {
		return false;
	}
}

/** What the app opens on before anybody has chosen. The OS decides the FIRST
 *  visit only; after that the saved look always wins — DESIGN.md § "The
 *  look". */
function firstLook(): BuiltInLook {
	return systemPrefersDark() ? 'graphite' : 'paper';
}

function defaults(): Prefs {
	return {
		look: firstLook(),
		style: 'default',
		effect: 'none',
		fonts: { ui: 'system', heading: 'system', mono: 'system' },
		css: '',
		tags: [],
		ground: 'dots',
		graph: null,
		alsoOnCanvas: [],
		wallpapers: {},
		views: {},
		walking: false,
		recordsWhatHappens: false,
		readingWidth: null,
		chatWidth: null,
		readingFull: false,
		deskNavOpen: true,
		tagOrder: 'count',
		columnGroups: { history: false, tags: true },
		density: 'auto',
		autosave: false,
		autosaveMinutes: 5,
		aiOffered: false,
		chatAgent: null,
		chatModel: {},
		chatInBackground: false,
		chatReachesWeb: true,
		origin: null
	};
}

/** A browser told to block site data throws on the ACCESSOR, so
 *  `typeof localStorage` is not a guard — it throws too. `runtime.ts` guards
 *  the session token the same way. */
function stored(): Partial<Prefs> & Record<string, unknown> {
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		return parsed && typeof parsed === 'object'
			? (parsed as Partial<Prefs> & Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

/** A look's id, or null where it is nothing an id could be. What resolves one
 *  is the collection, which is not here to check against. */
function lookIn(value: unknown): string | null {
	return typeof value === 'string' && LOOK_ID.test(value) ? value : null;
}

/** One face, as a name rather than as a rule — a family this build does not
 *  ship is still the person's to ask for, so only the bound is held. */
function faceIn(value: unknown, fallback: string): string {
	return typeof value === 'string' && namesAFace(value) ? value.trim() : fallback;
}

/** The three, with `was` the one face an earlier build kept. */
function facesIn(value: unknown, was: unknown): Prefs['fonts'] {
	const held = (typeof value === 'object' && value !== null ? value : {}) as Record<
		string,
		unknown
	>;
	return {
		ui: faceIn(held.ui, faceIn(was, 'system')),
		heading: faceIn(held.heading, 'system'),
		mono: faceIn(held.mono, 'system')
	};
}

/** The look's own rules, bounded. Whether they reach the network is answered
 *  where they are applied, so somebody can still see and fix what they hold. */
function rulesIn(value: unknown): string {
	return typeof value === 'string' && value.length <= LOOK_CSS_MAX ? value : '';
}

/** One token of a dressing, held to the same bound in both boot scripts. A name
 *  that is not a custom property would set a real CSS property on `<html>`, and
 *  a dressing is paint: `url(…)` in one would reach off the device. */
function paintsWith(token: string, paint: unknown): paint is string {
	return (
		/^--[a-z0-9-]{1,40}$/.test(token) &&
		typeof paint === 'string' &&
		/^[^;{}]{1,96}$/.test(paint) &&
		!/url\(/i.test(paint)
	);
}

function anotherAxisOwns(token: string): boolean {
	return (UNDRESSED_TOKENS as readonly string[]).includes(token);
}

function dressingIn(value: unknown): SchemeDressing | null {
	if (typeof value !== 'object' || value === null) return null;
	const held = value as Record<string, unknown>;
	const slug = lookIn(held.slug);
	if (slug === null) return null;
	if (typeof held.tokens !== 'object' || held.tokens === null) return null;
	const tokens: Record<string, string> = {};
	for (const [token, paint] of Object.entries(held.tokens as Record<string, unknown>)) {
		// Inline paint beats every rule, so what another axis owns is dropped here
		// rather than trusted. The cache the shells' boot scripts read is written
		// from this, so the one gate covers all three painters.
		if (paintsWith(token, paint) && !anotherAxisOwns(token)) tokens[token] = paint;
	}
	return { slug, variant: held.variant === 'dark' ? 'dark' : 'light', tokens };
}

function storedDressing(): SchemeDressing | null {
	try {
		const raw = localStorage.getItem(LOOK_KEY) ?? localStorage.getItem(WAS_LOOK_KEY);
		return raw ? dressingIn(JSON.parse(raw) as unknown) : null;
	} catch {
		return null;
	}
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return allowed.includes(value as T) ? (value as T) : fallback;
}

function oneNumberOf<T extends number>(value: unknown, allowed: readonly T[], fallback: T): T {
	return allowed.includes(value as T) ? (value as T) : fallback;
}

function groupsIn(value: unknown): { history: boolean; tags: boolean } {
	const held = (typeof value === 'object' && value !== null ? value : {}) as Record<
		string,
		unknown
	>;
	return { history: held.history === true, tags: held.tags !== false };
}

function widthIn(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Each entry through `TagSchema`, keeping the order and dropping the rest. */
function tagsIn(value: unknown): Tag[] {
	if (!Array.isArray(value)) return [];
	const out: Tag[] = [];
	for (const entry of value) {
		const parsed = TagSchema.safeParse(entry);
		if (parsed.success && !out.includes(parsed.data)) out.push(parsed.data);
	}
	return out;
}

/** One model per agent, as somebody spelled it — one this build does not name
 *  is still theirs to ask for, so only the bound is held. */
function modelsIn(value: unknown): Partial<Record<ChatAgent, string>> {
	if (typeof value !== 'object' || value === null) return {};
	const held = value as Record<string, unknown>;
	const out: Partial<Record<ChatAgent, string>> = {};
	for (const agent of CHAT_AGENTS) {
		const picked = held[agent];
		if (typeof picked === 'string' && picked.trim() !== '' && picked.length <= CHAT_MODEL_MAX)
			out[agent] = picked;
	}
	return out;
}

function refIn(value: unknown): OwnedRef | null {
	const parsed = OwnedRefSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

/** Each entry through `OwnedRefSchema`, keeping the order and dropping the rest. */
function refsIn(value: unknown): OwnedRef[] {
	if (!Array.isArray(value)) return [];
	const out: OwnedRef[] = [];
	for (const entry of value) {
		const ref = refIn(entry);
		if (ref !== null && !out.includes(ref)) out.push(ref);
	}
	return out;
}

/** How many folders' views are kept. Past a dozen the oldest of them is a
 *  folder nobody has had open in weeks. */
export const MOST_VIEWS = 12;

function spotIn(value: unknown): { x: number; y: number; scale: number } | null {
	if (typeof value !== 'object' || value === null) return null;
	const { x, y, scale } = value as Record<string, unknown>;
	if (typeof x !== 'number' || !Number.isFinite(x)) return null;
	if (typeof y !== 'number' || !Number.isFinite(y)) return null;
	if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) return null;
	return { x, y, scale };
}

function viewIn(value: unknown): FolderView | null {
	if (typeof value !== 'object' || value === null) return null;
	const held = value as Record<string, unknown>;
	const view: FolderView = {
		graph: refIn(held.graph),
		alsoOnCanvas: refsIn(held.alsoOnCanvas),
		tags: tagsIn(held.tags),
		walking: held.walking === true,
		folded: refsIn(held.folded),
		unfolded: refsIn(held.unfolded)
	};
	const note = refIn(held.note);
	if (note !== null) view.note = note;
	if (Array.isArray(held.notes)) view.notes = refsIn(held.notes);
	const spot = spotIn(held.viewport);
	if (spot !== null) view.viewport = spot;
	return view;
}

/** The {@link MOST_VIEWS} most recently written of them. A folder root is never
 *  an index, so the insertion order object keys keep is the order they were
 *  read in. */
function trimViews(views: Record<string, FolderView>): Record<string, FolderView> {
	const roots = Object.keys(views);
	if (roots.length <= MOST_VIEWS) return views;
	const out: Record<string, FolderView> = {};
	for (const root of roots.slice(roots.length - MOST_VIEWS)) out[root] = views[root];
	return out;
}

function viewsIn(value: unknown): Record<string, FolderView> {
	if (typeof value !== 'object' || value === null) return {};
	const out: Record<string, FolderView> = {};
	for (const [root, entry] of Object.entries(value as Record<string, unknown>)) {
		const view = viewIn(entry);
		if (view !== null) out[root] = view;
	}
	return trimViews(out);
}

/**
 * What somebody typed, as the origin Sloppy can be reached at, or null where it
 * is nothing Sloppy could talk to. A bare host is read as `https://`, since that
 * is how an address is written down; anything that survives keeps only the
 * scheme, host and port, so a path typed after it cannot re-root the app.
 */
export function asOrigin(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const typed = value.trim();
	if (typed === '') return null;
	const address = /^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`;
	if (!/^https?:\/\//i.test(address)) return null;
	try {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- read once and thrown away with this call.
		return new URL(address).origin;
	} catch {
		return null;
	}
}

/** Where this device's Sloppy is, read before {@link PrefsStore.init} has run —
 *  the app is pointed at it at boot, which is before any page mounts. */
export function storedOrigin(): string | null {
	return asOrigin(stored().origin);
}

class PrefsStore {
	#current = $state<Prefs>(defaults());
	/** The paint of the look the app is wearing, where it is carried as data and
	 *  cached. Null is a look `app.css` carries itself. */
	#dressing = $state<SchemeDressing | null>(null);
	/** The tokens {@link PrefsStore.apply} last painted, so painting another look
	 *  — or going back to one of Sloppy's own — takes exactly those off again.
	 *  The inset vars also written inline on `<html>` are not ours to clear. */
	#painted: string[] = [];
	/** Watching `<head>` for the stylesheets that arrive in it, while the look
	 *  has rules of its own standing there. */
	#watchingHead: MutationObserver | null = null;

	get current(): Prefs {
		return this.#current;
	}

	/** The paint of the look the app is wearing, or null where `app.css` carries
	 *  it. */
	get dressing(): SchemeDressing | null {
		return this.#dressing;
	}

	get isDark(): boolean {
		if (this.#dressing !== null) return this.#dressing.variant === 'dark';
		return DARK_LOOKS.includes(this.#current.look);
	}

	/** Call once from the shell's root layout. Re-reads storage, so a shell may
	 *  call it again after erasing the device. */
	init(): void {
		const base = defaults();
		const saved = stored();
		// The scheme an earlier build was dressed in, and the theme it wore
		// otherwise, are each the look of that name; the accent it kept is the one
		// that look now carries.
		const look =
			lookIn(saved.look) ?? lookIn(saved.scheme) ?? oneOf(saved.theme, BUILT_IN_LOOKS, firstLook());
		const cached = storedDressing();
		// An id with no tokens beside it is still the look somebody chose: what
		// resolves one is the collection, and it can paint the app again later.
		this.#dressing = cached !== null && cached.slug === look ? cached : null;
		this.#current = {
			look,
			style: oneOf(saved.style, STYLES, base.style),
			effect: oneOf(saved.effect, EFFECTS, base.effect),
			fonts: facesIn(saved.fonts, saved.font),
			css: rulesIn(saved.css),
			tags: tagsIn(saved.tags),
			ground: oneOf(saved.ground, GRAPH_GROUNDS, base.ground),
			graph: refIn(saved.graph),
			alsoOnCanvas: refsIn(saved.alsoOnCanvas),
			wallpapers: sanitizeWallpapers(saved.wallpapers),
			views: viewsIn(saved.views),
			walking: saved.walking === true,
			recordsWhatHappens: saved.recordsWhatHappens === true,
			readingWidth: widthIn(saved.readingWidth),
			chatWidth: widthIn(saved.chatWidth),
			readingFull: saved.readingFull === true,
			deskNavOpen: saved.deskNavOpen !== false,
			tagOrder: saved.tagOrder === 'name' ? 'name' : 'count',
			columnGroups: groupsIn(saved.columnGroups),
			density: oneOf(saved.density, DENSITIES, base.density),
			autosave: saved.autosave === true,
			autosaveMinutes: oneNumberOf(saved.autosaveMinutes, AUTOSAVE_MINUTES, 5),
			aiOffered: saved.aiOffered === true,
			chatAgent: CHAT_AGENTS.includes(saved.chatAgent as ChatAgent)
				? (saved.chatAgent as ChatAgent)
				: null,
			chatModel: modelsIn(saved.chatModel),
			chatInBackground: saved.chatInBackground === true,
			chatReachesWeb: saved.chatReachesWeb !== false,
			origin: asOrigin(saved.origin)
		};
		this.apply();
	}

	/** The picture under one graph, or null where it has none. */
	wallpaper(graph: OwnedRef): WallpaperPrefs | null {
		return this.#current.wallpapers[graph] ?? null;
	}

	setWallpaper(graph: OwnedRef, next: WallpaperPrefs | null): void {
		const wallpapers = { ...this.#current.wallpapers };
		if (next === null) delete wallpapers[graph];
		else wallpapers[graph] = next;
		this.set('wallpapers', wallpapers);
	}

	/** How that folder was last being read, or null where nothing was kept for
	 *  it — a folder nobody has opened, and one whose tab was closed. */
	view(root: string): FolderView | null {
		return this.#current.views[root] ?? null;
	}

	setView(root: string, next: FolderView | null): void {
		const views = { ...this.#current.views };
		// Written again goes to the end, so the folder read most recently is the
		// last of them to be dropped.
		delete views[root];
		if (next !== null) views[root] = next;
		this.set('views', trimViews(views));
	}

	/**
	 * Wear a look: `slug` is the look, and `dressing` its paint where it is
	 * carried as data rather than by `app.css` — null for one of Sloppy's own,
	 * and for an id whose paint is not in hand. The paint is cached under its own
	 * key for the shells' boot scripts, which paint the first paint from it
	 * before this store has run.
	 *
	 * It takes the whole dressing rather than the tokens alone: which way a
	 * look's ground runs is the collection's own answer, and reading it back out
	 * of the paint would be a second, weaker one.
	 */
	setLook(dressing: SchemeDressing | null, slug: string): void {
		this.#dress(dressing === null ? null : dressingIn(dressing));
		this.set('look', slug);
	}

	#dress(dressing: SchemeDressing | null): void {
		this.#dressing = dressing;
		try {
			if (dressing === null) localStorage.removeItem(LOOK_KEY);
			else localStorage.setItem(LOOK_KEY, JSON.stringify(dressing));
			localStorage.removeItem(WAS_LOOK_KEY);
		} catch {
			// Memory already holds it; only the first paint of the next visit is
			// lost, and this store paints the app again as soon as it runs.
		}
	}

	set<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
		const next: Prefs = { ...this.#current, [key]: value };
		// Paint in hand belongs to one look, so asking for another stands it down
		// — which is what makes `setLook` the only way to wear a painted one.
		if (key === 'look' && this.#dressing !== null && value !== this.#dressing.slug) {
			this.#dress(null);
		}
		// A graph, the canvas beside it, the pictures under them and how each
		// folder was being read are refs the Sloppy being left minted; they mean
		// nothing on the next one.
		if (key === 'origin' && value !== this.#current.origin) {
			next.graph = null;
			next.alsoOnCanvas = [];
			next.wallpapers = {};
			next.views = {};
		}
		this.#current = next;
		this.#persist();
		this.apply();
	}

	#persist(): void {
		try {
			localStorage.setItem(KEY, JSON.stringify(this.#current));
		} catch {
			// Memory already holds it; only carrying the choice to the next visit
			// is lost.
		}
	}

	apply(): void {
		if (typeof document === 'undefined') return;
		const root = document.documentElement;
		const p = this.#current;
		const dressing = this.#dressing;
		for (const token of this.#painted) root.style.removeProperty(token);
		this.#painted = [];
		if (dressing !== null) {
			for (const [token, paint] of Object.entries(dressing.tokens)) {
				root.style.setProperty(token, paint);
				this.#painted.push(token);
			}
		}
		// The one attribute that decides colour, and the one the canvas and the
		// browser's own chrome watch — DESIGN.md § "The look".
		root.setAttribute('data-look', p.look);
		// Absent IS the default style: app.css only ever keys off the opt-in value.
		if (p.style === 'default') root.removeAttribute('data-style');
		else root.setAttribute('data-style', p.style);
		// Absent IS comfortable, the same bargain the style axis makes.
		if (densityNow(p.density) === 'compact') root.setAttribute('data-density', 'compact');
		else root.removeAttribute('data-density');
		if (p.effect === 'none') root.removeAttribute('data-effect');
		else root.setAttribute('data-effect', p.effect);
		// The three faces, written over the tokens `app.css` declares them at:
		// a family a look asks for by name is not a value a stylesheet can hold
		// a block for — DESIGN.md § Typography.
		for (const role of FACE_ROLES) {
			const stack = faceStack(role, p.fonts[role]);
			if (stack === null) root.style.removeProperty(FACE_TOKENS[role].token);
			else root.style.setProperty(FACE_TOKENS[role].token, stack);
		}
		// Legibility outranks alignment: a face that cannot hold its figures to
		// one width takes the addresses anyway, without their column.
		const keepsTheColumn = shippedFace(p.fonts.mono)?.oneWidthFigures ?? true;
		for (const token of ['--font-address-figures', '--font-address-features']) {
			if (keepsTheColumn) root.style.removeProperty(token);
			else root.style.setProperty(token, 'normal');
		}
		root.classList.toggle('dark', this.isDark);
		this.#writeRules(p.css);
	}

	/** The look's own rules, in the one element they are ever written into. A
	 *  look that would reach the network is left unwritten rather than refused
	 *  outright: what it holds stays in front of whoever can fix it. */
	#writeRules(css: string): void {
		const held = document.getElementById(LOOK_RULES);
		if (css === '' || cssIsSafe(css) !== null) {
			held?.remove();
			this.#watchingHead?.disconnect();
			this.#watchingHead = null;
			return;
		}
		const sheet = held ?? document.createElement('style');
		sheet.id = LOOK_RULES;
		if (sheet.textContent !== css) sheet.textContent = css;
		this.#rulesLast(sheet);
		if (this.#watchingHead !== null || typeof MutationObserver === 'undefined') return;
		this.#watchingHead = new MutationObserver(() =>
			this.#rulesLast(document.getElementById(LOOK_RULES))
		);
		this.#watchingHead.observe(document.head, { childList: true });
	}

	/** The rules go last in `<head>` and are held there: the app's own stylesheet
	 *  and a page's are appended to it as they load — after the boot script wrote
	 *  these rules — and a tie with either of them is decided by nothing but
	 *  which came last. */
	#rulesLast(sheet: HTMLElement | null): void {
		if (sheet !== null && document.head.lastElementChild !== sheet)
			document.head.appendChild(sheet);
	}

	/** A mouse plugged into a tablet, or taken out again, changes what this
	 *  device is — so `auto` is answered again rather than at boot only. */
	watchThePointer(): () => void {
		if (typeof matchMedia === 'undefined') return () => {};
		const asked = matchMedia('(any-pointer: coarse)');
		const again = () => this.apply();
		asked.addEventListener('change', again);
		return () => asked.removeEventListener('change', again);
	}
}

export const prefs = new PrefsStore();
