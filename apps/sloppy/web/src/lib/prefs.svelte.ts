/**
 * The look of the app, as three independent choices — DESIGN.md § Theme owns
 * what each one means and which values exist. Nothing here reaches the server:
 * a preference is this browser's, and it needs no account.
 */

export const THEMES = ['paper', 'graphite', 'light', 'dark', 'contrast'] as const;
export const ACCENTS = ['indigo', 'moss', 'rust', 'sea', 'iris', 'ochre', 'slate'] as const;
export const STYLES = ['default', 'hardline'] as const;

export type Theme = (typeof THEMES)[number];
export type Accent = (typeof ACCENTS)[number];
export type Style = (typeof STYLES)[number];

export interface Prefs {
	theme: Theme;
	accent: Accent;
	style: Style;
}

const KEY = 'sloppy_prefs';

/** Themes that also carry the `dark` class, so Tailwind's `dark:` variants fire.
 *  `app.html`'s boot script holds the same list; DESIGN.md § Theme says why. */
const DARK_THEMES = new Set<Theme>(['graphite', 'dark']);

function attribute<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
	const value = document.documentElement.getAttribute(name);
	return allowed.includes(value as T) ? (value as T) : fallback;
}

function apply(next: Prefs): void {
	const root = document.documentElement;
	root.setAttribute('data-theme', next.theme);
	root.setAttribute('data-accent', next.accent);
	if (next.style === 'default') root.removeAttribute('data-style');
	else root.setAttribute('data-style', next.style);
	root.classList.toggle('dark', DARK_THEMES.has(next.theme));
}

function persist(next: Prefs): void {
	try {
		const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
		const base = stored && typeof stored === 'object' ? stored : {};
		localStorage.setItem(KEY, JSON.stringify({ ...base, ...next }));
	} catch {
		// The choice still holds for as long as this tab is open.
	}
}

class PrefsStore {
	theme = $state<Theme>('paper');
	accent = $state<Accent>('indigo');
	style = $state<Style>('default');

	/** Adopt what `app.html` already painted, rather than deriving it twice. */
	init(): void {
		this.theme = attribute('data-theme', THEMES, this.theme);
		this.accent = attribute('data-accent', ACCENTS, this.accent);
		this.style = attribute('data-style', STYLES, this.style);
	}

	set(patch: Partial<Prefs>): void {
		const next: Prefs = { theme: this.theme, accent: this.accent, style: this.style, ...patch };
		this.theme = next.theme;
		this.accent = next.accent;
		this.style = next.style;
		apply(next);
		persist(next);
	}
}

export const prefs = new PrefsStore();
