/**
 * A scheme is a theme carried as data rather than as a block in `app.css` —
 * DESIGN.md § Schemes. What a scheme resolves to is a DRESSING: the tokens to
 * paint on `<html>`, and which way its ground runs.
 */

/**
 * The tokens a dressing MUST carry. A dressing missing one of these leaves that
 * token at whatever `:root` last said, which is a surface from one palette drawn
 * against ink from another.
 */
export const DRESSED_TOKENS = [
	'--background',
	'--foreground',
	'--card',
	'--card-foreground',
	'--popover',
	'--popover-foreground',
	'--muted',
	'--muted-foreground',
	'--input',
	'--secondary',
	'--secondary-foreground',
	'--accent',
	'--accent-foreground',
	'--destructive',
	'--destructive-foreground',
	'--graph-ink',
	'--graph-paper',
	'--facet-1',
	'--facet-2',
	'--facet-3',
	'--facet-4',
	'--facet-5',
	'--facet-6',
	'--facet-7',
	'--facet-8'
] as const;

/**
 * The tokens a dressing may NOT carry, however much else of the palette it
 * carries. A dressing paints inline on `<html>`, which beats every rule in
 * `app.css`, so a scheme naming one of these takes an axis off the person:
 *
 * - The accent family is the person's across every scheme, the focus ring with
 *   it, and `--primary-mark` carries a correction a scheme cannot know about.
 * - `--border` is what the style axis derives an edge from. A scheme's own edge
 *   reaches it through `schemes.css`, in a rule a style can still beat.
 */
export const UNDRESSED_TOKENS = [
	'--border',
	'--primary',
	'--primary-foreground',
	'--primary-mark',
	'--ring'
] as const;

export type DressedToken = (typeof DRESSED_TOKENS)[number];

/** The paint itself, open past {@link DRESSED_TOKENS} so a dressing may carry
 *  more of the palette than the minimum — but never a {@link UNDRESSED_TOKENS}. */
export interface SchemeTokens {
	readonly [token: `--${string}`]: string;
}

export interface SchemeDressing {
	/** The scheme's slug in the collection, which is what prefs keep. */
	slug: string;
	/** Which way the ground runs, for the `dark` class and `color-scheme`. */
	variant: 'light' | 'dark';
	tokens: SchemeTokens;
}

/** `base00`–`base0F`, the sixteen every scheme in the collection carries. */
export const BASE_KEYS = [
	'base00',
	'base01',
	'base02',
	'base03',
	'base04',
	'base05',
	'base06',
	'base07',
	'base08',
	'base09',
	'base0A',
	'base0B',
	'base0C',
	'base0D',
	'base0E',
	'base0F'
] as const;

export type BaseKey = (typeof BASE_KEYS)[number];

/** One scheme as the collection states it. `scripts/vendor-schemes.mjs` writes
 *  them into `schemes/schemes.json`, which is the only copy. */
export interface Scheme {
	/** A `base24` scheme carries eight colours past the sixteen; the dressing
	 *  reads none of them. */
	readonly system: 'base16' | 'base24';
	/** What prefs keep and `data-scheme` carries. Unique in the collection. */
	readonly slug: string;
	readonly name: string;
	/** As the collection credits them, and empty where it credits nobody. */
	readonly author: string;
	/** Which way the scheme's own ground runs — the collection's declaration,
	 *  rather than something read back off its surface. */
	readonly variant: 'light' | 'dark';
	/** Six-digit hex, `#rrggbb`, checked where the collection is vendored. */
	readonly palette: Readonly<Record<BaseKey, string>> & Readonly<Record<string, string>>;
}
