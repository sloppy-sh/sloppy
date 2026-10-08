/**
 * A scheme is a theme carried as data rather than as a block in `app.css` —
 * DESIGN.md § Schemes. What a scheme resolves to is a DRESSING: the tokens to
 * paint on `<html>`, and which way its ground runs.
 */

/**
 * The tokens a dressing MUST carry. A dressing missing one of these leaves that
 * token at whatever the theme blocks last said, which is a surface from one
 * palette drawn against ink from another.
 *
 * `--primary` and its family are deliberately absent: the accent axis stays the
 * person's, as do style, font and density.
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
	'--border',
	'--input',
	'--ring',
	'--secondary',
	'--secondary-foreground',
	'--accent',
	'--accent-foreground',
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

export type DressedToken = (typeof DRESSED_TOKENS)[number];

/** The paint itself, open past {@link DRESSED_TOKENS} so a dressing may carry
 *  more of the palette than the minimum. */
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
