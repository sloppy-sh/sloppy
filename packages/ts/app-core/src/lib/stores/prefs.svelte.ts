/**
 * The look of the app and the tags it opens on — DESIGN.md § Persistence — and
 * which Sloppy this device talks to — docs/ARCHITECTURE.md § "Deployment
 * modes". One writer for `sloppy_prefs`, and the only code that sets the four
 * axis attributes on `<html>` after first paint.
 *
 * The shells' `app.html` boot scripts read the SAME key to theme the first
 * paint, so the key, the field names, the first-visit defaults and the dark
 * roster below are all shared with them. Changing any of the four means
 * changing both boot scripts in the same commit.
 */

import { GRAPH_GROUNDS, type GraphGround } from '@sloppy/graph';
import {
	CHAT_AGENTS,
	CHAT_MODEL_MAX,
	type ChatAgent,
	type OwnedRef,
	OwnedRefSchema,
	type Tag,
	TagSchema
} from '@sloppy/types';
import { sanitizeWallpapers, type WallpaperPrefs } from '../wallpaper.js';

export type Theme = 'paper' | 'graphite' | 'light' | 'dark' | 'contrast';
export type Accent = 'indigo' | 'moss' | 'rust' | 'sea' | 'iris' | 'ochre' | 'slate';
export type Style = 'default' | 'hardline';
export type Font = 'system' | 'atkinson' | 'opendyslexic' | 'apple';
export type Density = 'auto' | 'comfortable' | 'compact';

export interface Prefs {
	theme: Theme;
	accent: Accent;
	style: Style;
	/** The face the whole app is read in — DESIGN.md § Typography. */
	font: Font;
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
	/** The Sloppy this device talks to, as an origin — docs/ARCHITECTURE.md
	 *  § "Deployment modes". Null is the one the app came with, which is what
	 *  the shell names. */
	origin: string | null;
}

const KEY = 'sloppy_prefs';
const DARK_THEMES: readonly Theme[] = ['graphite', 'dark'];

export const THEME_LABELS: Record<Theme, string> = {
	paper: 'Paper',
	graphite: 'Graphite',
	light: 'Light',
	dark: 'Dark',
	contrast: 'High contrast'
};
export const ACCENT_LABELS: Record<Accent, string> = {
	indigo: 'Indigo',
	moss: 'Moss',
	rust: 'Rust',
	sea: 'Sea',
	iris: 'Iris',
	ochre: 'Ochre',
	slate: 'Slate'
};
export const STYLE_LABELS: Record<Style, string> = {
	default: 'Default',
	hardline: 'Hardline'
};
export const FONT_LABELS: Record<Font, string> = {
	system: 'Default',
	atkinson: 'Atkinson Hyperlegible',
	opendyslexic: 'OpenDyslexic',
	apple: "Your device's face"
};
export const DENSITY_LABELS: Record<Density, string> = {
	auto: 'What this device is',
	comfortable: 'Comfortable',
	compact: 'Compact'
};

export const THEMES = Object.keys(THEME_LABELS) as Theme[];
export const ACCENTS = Object.keys(ACCENT_LABELS) as Accent[];
export const STYLES = Object.keys(STYLE_LABELS) as Style[];
export const FONTS = Object.keys(FONT_LABELS) as Font[];
export const DENSITIES = Object.keys(DENSITY_LABELS) as Density[];

/** How long between versions kept while writing, in minutes. */
export const AUTOSAVE_MINUTES = [2, 5, 15, 30] as const;

/**
 * Whether this device is one where everything can be drawn closer: a mouse and
 * nothing else. A screen somebody might reach for is drawn for a finger,
 * whatever else is plugged in. **These two queries are the whole of what a
 * webview can honestly read about it** — DESIGN.md § Theme.
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

/** The OS decides the FIRST visit only; after that the saved value always wins
 *  (DESIGN.md § Theme). */
function defaults(): Prefs {
	return {
		theme: systemPrefersDark() ? 'graphite' : 'paper',
		accent: 'indigo',
		style: 'default',
		font: 'system',
		tags: [],
		ground: 'dots',
		graph: null,
		alsoOnCanvas: [],
		wallpapers: {},
		walking: false,
		recordsWhatHappens: false,
		readingWidth: null,
		chatWidth: null,
		deskNavOpen: true,
		tagOrder: 'count',
		columnGroups: { history: false, tags: true },
		density: 'auto',
		autosave: false,
		autosaveMinutes: 5,
		aiOffered: false,
		chatAgent: null,
		chatModel: {},
		origin: null
	};
}

/** A browser told to block site data throws on the ACCESSOR, so
 *  `typeof localStorage` is not a guard — it throws too. `runtime.ts` guards
 *  the session token the same way. */
function stored(): Partial<Prefs> {
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		return parsed && typeof parsed === 'object' ? (parsed as Partial<Prefs>) : {};
	} catch {
		return {};
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

	get current(): Prefs {
		return this.#current;
	}

	get isDark(): boolean {
		return DARK_THEMES.includes(this.#current.theme);
	}

	/** Call once from the shell's root layout. Re-reads storage, so a shell may
	 *  call it again after erasing the device. */
	init(): void {
		const base = defaults();
		const saved = stored();
		this.#current = {
			theme: oneOf(saved.theme, THEMES, base.theme),
			accent: oneOf(saved.accent, ACCENTS, base.accent),
			style: oneOf(saved.style, STYLES, base.style),
			font: oneOf(saved.font, FONTS, base.font),
			tags: tagsIn(saved.tags),
			ground: oneOf(saved.ground, GRAPH_GROUNDS, base.ground),
			graph: refIn(saved.graph),
			alsoOnCanvas: refsIn(saved.alsoOnCanvas),
			wallpapers: sanitizeWallpapers(saved.wallpapers),
			walking: saved.walking === true,
			recordsWhatHappens: saved.recordsWhatHappens === true,
			readingWidth: widthIn(saved.readingWidth),
			chatWidth: widthIn(saved.chatWidth),
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

	set<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
		const next: Prefs = { ...this.#current, [key]: value };
		// A graph, the canvas beside it and the pictures under them are refs the
		// Sloppy being left minted; they mean nothing on the next one.
		if (key === 'origin' && value !== this.#current.origin) {
			next.graph = null;
			next.alsoOnCanvas = [];
			next.wallpapers = {};
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
		root.setAttribute('data-theme', p.theme);
		root.setAttribute('data-accent', p.accent);
		// Absent IS the default style: app.css only ever keys off the opt-in value.
		if (p.style === 'default') root.removeAttribute('data-style');
		else root.setAttribute('data-style', p.style);
		if (p.font === 'system') root.removeAttribute('data-app-font');
		else root.setAttribute('data-app-font', p.font);
		// Absent IS comfortable, the same bargain the style and font axes make.
		if (densityNow(p.density) === 'compact') root.setAttribute('data-density', 'compact');
		else root.removeAttribute('data-density');
		root.classList.toggle('dark', this.isDark);
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
