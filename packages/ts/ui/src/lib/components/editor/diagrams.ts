// Drawing a diagram from the source somebody wrote, keyed by the language they
// wrote it in. What a fence OPENS a diagram in is `DIAGRAM_LANGUAGES` in
// `@sloppy/types`, which a vault reads by too; this is only what this build
// draws, and a language in neither is still carried whole.

/** The one this build draws. Anything else is carried and shown as its source. */
export const MERMAID = 'mermaid';

type Drawer = (source: string) => Promise<string>;

let loading: Promise<typeof import('mermaid').default> | null = null;

/** Bundled with the app and brought in the first time a diagram is drawn, so a
 *  note with none in it never pays for it. */
async function mermaid(): Promise<typeof import('mermaid').default> {
	loading ??= import('mermaid').then((module) => module.default);
	return loading;
}

/** Said where a diagram will not draw and nothing said why. */
export const NOT_DRAWN = "This diagram didn't come out.";

/** The renderer finds what it is drawing by id under `document.body`, so no two
 *  drawings in flight may go by the same name. */
let named = 0;

/**
 * Told nowhere to draw, the renderer draws into `document.body` and leaves what
 * it drew there — a picture of the error included. So it is always told here:
 * a place of this module's own, off-screen for the moment it takes, and taken
 * away again on every path out of {@link drawDiagram}.
 */
function somewhereToDraw(): HTMLElement {
	const holding = document.createElement('div');
	holding.setAttribute('aria-hidden', 'true');
	holding.style.cssText = 'position:fixed;top:0;left:-10000px;pointer-events:none';
	document.body.append(holding);
	return holding;
}

const DRAWS: Record<string, Drawer> = {
	[MERMAID]: async (source) => {
		const draw = await mermaid();
		draw.initialize({
			startOnLoad: false,
			// A held note draws its author's diagram, so the labels in it are
			// somebody else's text: this is what keeps them from being markup.
			securityLevel: 'strict',
			// Without this the renderer answers a source it cannot read by drawing
			// a picture of the complaint instead of the diagram.
			suppressErrorRendering: true,
			theme: darkNow() ? 'dark' : 'neutral'
		});
		// Read before drawn, so a source it cannot read costs no drawing at all.
		await draw.parse(source);
		const holding = somewhereToDraw();
		try {
			const { svg } = await draw.render(`sloppy-diagram-${++named}`, source, holding);
			return svg;
		} finally {
			holding.remove();
		}
	}
};

export function drawsDiagrams(language: string): boolean {
	return language in DRAWS;
}

/** The SVG for one diagram, drawn nowhere the page can see. Rejects where the
 *  source will not draw, with what the renderer said about it. */
export async function drawDiagram(language: string, source: string): Promise<string> {
	const draw = DRAWS[language];
	if (!draw) throw new Error(`No renderer for ${language}`);
	return draw(source);
}

/**
 * What is wrong with a diagram, in the words of whatever draws it, and
 * {@link NOT_DRAWN} where it will not draw and nothing said why. Absent is
 * nothing to say: the source draws, or it is blank, or its language is one
 * this build has no renderer for and carries as it was written. Asking draws
 * the diagram out of sight and leaves the page as it was found.
 */
export async function troubleWithDiagram(
	language: string,
	source: string
): Promise<string | undefined> {
	const written = source.trim();
	if (written === '' || !drawsDiagrams(language)) return undefined;
	try {
		await drawDiagram(language, written);
		return undefined;
	} catch (error) {
		const said = error instanceof Error ? error.message.trim() : '';
		return said === '' ? NOT_DRAWN : said;
	}
}

/** The dark families carry the `dark` class on <html>; app.css § the `dark`
 *  variant is where that is declared. */
function darkNow(): boolean {
	return document.documentElement.classList.contains('dark');
}

const watching = new Set<() => void>();
let watcher: MutationObserver | null = null;

/** Calls back when the reader changes theme, so a diagram drawn in one is drawn
 *  again in the other rather than staying ink-on-ink. */
export function whenThemeChanges(redraw: () => void): () => void {
	watching.add(redraw);
	watcher ??= new MutationObserver(() => {
		for (const called of watching) called();
	});
	watcher.observe(document.documentElement, { attributeFilter: ['class'] });
	return () => {
		watching.delete(redraw);
		if (watching.size > 0) return;
		watcher?.disconnect();
		watcher = null;
	};
}
