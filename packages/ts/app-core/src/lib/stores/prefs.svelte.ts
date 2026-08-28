/**
 * The look of the app, and the tags it opens on — DESIGN.md § Persistence.
 * One writer for `sloppy_prefs`, and the only code that sets the three axis
 * attributes on `<html>` after first paint.
 *
 * The shells' `app.html` boot scripts read the SAME key to theme the first
 * paint, so the key, the field names, the first-visit defaults and the dark
 * roster below are all shared with them. Changing any of the four means
 * changing both boot scripts in the same commit.
 */

import { type Tag, TagSchema } from '@sloppy/types';

export type Theme = 'paper' | 'graphite' | 'light' | 'dark' | 'contrast';
export type Accent = 'indigo' | 'moss' | 'rust' | 'sea' | 'iris' | 'ochre' | 'slate';
export type Style = 'default' | 'hardline';

export interface Prefs {
	theme: Theme;
	accent: Accent;
	style: Style;
	/** The tags the graph is lit by, in SELECTION order — that order hands out
	 *  the hues, so sorting it would repaint the reader's question. Empty is the
	 *  monochrome graph DESIGN.md § Hue calls for when nothing has been asked. */
	tags: Tag[];
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

export const THEMES = Object.keys(THEME_LABELS) as Theme[];
export const ACCENTS = Object.keys(ACCENT_LABELS) as Accent[];
export const STYLES = Object.keys(STYLE_LABELS) as Style[];

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
		tags: []
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
			tags: tagsIn(saved.tags)
		};
		this.apply();
	}

	set<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
		this.#current = { ...this.#current, [key]: value };
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
		root.classList.toggle('dark', this.isDark);
		root.style.colorScheme = this.isDark ? 'dark' : 'light';
	}
}

export const prefs = new PrefsStore();
