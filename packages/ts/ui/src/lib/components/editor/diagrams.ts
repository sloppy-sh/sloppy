// Drawing a diagram from the source somebody wrote, keyed by the language they
// wrote it in. A second language is another entry in `DRAWS` and a renderer
// beside it, never a change to what a diagram element stores.

/** The one this build draws. Anything else is carried and shown as its source. */
export const MERMAID = 'mermaid';

type Drawer = (source: string, id: string) => Promise<string>;

let loading: Promise<typeof import('mermaid').default> | null = null;

/** Bundled with the app and brought in the first time a diagram is drawn, so a
 *  note with none in it never pays for it. */
async function mermaid(): Promise<typeof import('mermaid').default> {
	loading ??= import('mermaid').then((module) => module.default);
	return loading;
}

const DRAWS: Record<string, Drawer> = {
	[MERMAID]: async (source, id) => {
		const draw = await mermaid();
		draw.initialize({
			startOnLoad: false,
			// A held note draws its author's diagram, so the labels in it are
			// somebody else's text: this is what keeps them from being markup.
			securityLevel: 'strict',
			theme: darkNow() ? 'dark' : 'neutral'
		});
		const { svg } = await draw.render(id, source);
		return svg;
	}
};

/** Every language a fence opens a diagram in, and the whole of what this build
 *  draws. */
export const DIAGRAM_LANGUAGES: readonly string[] = Object.keys(DRAWS);

export function drawsDiagrams(language: string): boolean {
	return language in DRAWS;
}

/** The SVG for one diagram. Rejects where the source does not parse, with what
 *  the renderer said about it. */
export async function drawDiagram(language: string, source: string, id: string): Promise<string> {
	const draw = DRAWS[language];
	if (!draw) throw new Error(`No renderer for ${language}`);
	return draw(source, id);
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
