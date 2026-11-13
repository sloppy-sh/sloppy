// Colour on code, in the grammars and the two schemes the desk colours it in
// (packages/ts/ui/src/lib/components/editor/highlight.ts).

import type { Element } from "hast";
import type { HighlighterCore } from "shiki/core";

const THEMES = { light: "github-light", dark: "github-dark" } as const;

/** File endings that are neither a grammar's id nor one of its own aliases. */
const ENDINGS: Record<string, string> = {
  h: "c",
  hh: "cpp",
  hpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  ex: "elixir",
  exs: "elixir",
  ps1: "powershell",
  gradle: "groovy",
};

let loading: Promise<HighlighterCore> | null = null;
function highlighter(): Promise<HighlighterCore> {
  loading ??= Promise.all([
    import("shiki/core"),
    import("shiki/engine/javascript"),
  ]).then(([{ createHighlighterCore }, { createJavaScriptRegexEngine }]) =>
    createHighlighterCore({
      themes: [
        import("shiki/themes/github-light.mjs"),
        import("shiki/themes/github-dark.mjs"),
      ],
      langs: [],
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    }),
  );
  return loading;
}

let names: Promise<Map<string, string>> | null = null;
function known(): Promise<Map<string, string>> {
  names ??= import("shiki/langs").then(({ bundledLanguagesInfo }) => {
    const map = new Map(Object.entries(ENDINGS));
    for (const info of bundledLanguagesInfo) {
      map.set(info.id, info.id);
      for (const alias of info.aliases ?? []) map.set(alias, info.id);
    }
    return map;
  });
  return names;
}

/** The `<pre>` for `source` coloured as `language`, both schemes carried as
 *  `--shiki-light` and `--shiki-dark` on each run; undefined where no grammar
 *  answers to the name. */
export async function colouredBlock(
  source: string,
  language: string,
): Promise<Element | undefined> {
  const id = (await known()).get(language.trim().toLowerCase());
  if (!id) return undefined;
  const held = await highlighter();
  if (!held.getLoadedLanguages().includes(id)) {
    const { bundledLanguages } = await import("shiki/langs");
    await held.loadLanguage(
      bundledLanguages[id as keyof typeof bundledLanguages],
    );
  }
  // WebKit's first run of a grammar's rules matches wrongly, and the second
  // right: this pass is the first.
  held.codeToTokensBase(source, { lang: id, theme: THEMES.light });
  const root = held.codeToHast(source, {
    lang: id,
    themes: THEMES,
    defaultColor: false,
  });
  const pre = root.children.find(
    (child): child is Element => child.type === "element",
  );
  if (pre) delete pre.properties.style;
  return pre;
}
