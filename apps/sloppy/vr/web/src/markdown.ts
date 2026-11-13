// A note's markdown as the HTML the page shows: the author's writing sanitised
// first, then coloured, linked and pictured by this page alone.

import { opensDiagram } from "@sloppy/types";
import type { Element, ElementContent, Root as HastRoot } from "hast";
import type {
  Image,
  Link,
  PhrasingContent,
  Root as MdastRoot,
  Text,
} from "mdast";
import rehypeSanitize, { defaultSchema, type Options } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { type PluggableList, unified } from "unified";
import { SKIP, visit } from "unist-util-visit";
import { colouredBlock } from "./code";
import { CITATION, noteNamed, onTheWeb, staysOnPage } from "./links";
import type { Asked } from "./wire";

export const PICTURE = "A picture";
export const DRAWING = "A drawing";
const PICTURE_NAMED = "Picture: %s";
const DRAWING_NAMED = "Drawing: %s";
/** A cited note the reader has no title for. */
export const CITED = "a note";

const WIKI_CITATION = /\[\[([^\]\n]+)\]\]/g;
const MATH = /\$/;

const schema: Options = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    // A citation, and a ref written bare, whose principal may be a DID.
    href: [
      ...(defaultSchema.protocols?.href ?? []),
      CITATION.slice(0, -1),
      "did",
    ],
    src: ["data"],
  },
  attributes: {
    ...defaultSchema.attributes,
    code: [["className", /^language-./, "math-inline", "math-display"]],
    em: [["className", "picture-unseen"]],
  },
};

/** The HTML for `asked.markdown`. Diagrams come out as their source inside
 *  `figure[data-diagram]`, for the page to draw where it can. */
export async function toHtml(asked: Asked): Promise<string> {
  const math = MATH.test(asked.markdown);
  const before: PluggableList = [remarkGfm];
  const after: PluggableList = [];
  if (math) {
    const [{ default: remarkMath }, { default: rehypeKatex }] =
      await Promise.all([import("remark-math"), import("rehype-katex")]);
    before.push(remarkMath);
    after.push([rehypeKatex, { throwOnError: false }]);
  }
  const processor = unified()
    .use(remarkParse)
    .use(before)
    .use(citations, asked.named ?? {})
    .use(pictures, asked.pictures ?? {})
    .use(remarkRehype)
    .use(rehypeSanitize, schema)
    .use(after)
    .use(decorate)
    .use(rehypeStringify);
  return String(await processor.process(asked.markdown));
}

function citations(named: Record<string, string>) {
  const title = (said: string) => {
    const at = noteNamed(said);
    if (!at) return undefined;
    return "note" in at ? (named[at.note] ?? CITED) : at.address;
  };
  return (tree: MdastRoot) => {
    visit(tree, "text", (node: Text, index, parent) => {
      if (!parent || index === undefined || parent.type === "link") return;
      const pieces: PhrasingContent[] = [];
      let from = 0;
      for (const found of node.value.matchAll(WIKI_CITATION)) {
        const said = found[1].trim();
        const words = title(said);
        if (words === undefined) continue;
        if (found.index > from)
          pieces.push({
            type: "text",
            value: node.value.slice(from, found.index),
          });
        pieces.push({
          type: "link",
          url: CITATION + said,
          children: [{ type: "text", value: words }],
        });
        from = found.index + found[0].length;
      }
      if (pieces.length === 0) return;
      if (from < node.value.length)
        pieces.push({ type: "text", value: node.value.slice(from) });
      parent.children.splice(index, 1, ...pieces);
      return [SKIP, index + pieces.length];
    });
    visit(tree, "link", (node: Link) => {
      const said = node.children.every(
        (child) => child.type === "text" && child.value.trim() === "",
      );
      const words = said ? title(node.url) : undefined;
      if (words !== undefined) node.children = [{ type: "text", value: words }];
    });
  };
}

function pictures(given: Record<string, string>) {
  const dataOf = (path: string) => {
    const found = given[path] ?? given[safelyDecoded(path)];
    return found?.startsWith("data:image/") ? found : undefined;
  };
  return (tree: MdastRoot) => {
    visit(tree, "image", (node: Image, index, parent) => {
      if (!parent || index === undefined) return;
      const data = dataOf(node.url);
      if (data) {
        node.url = data;
        return;
      }
      parent.children.splice(index, 1, {
        type: "emphasis",
        data: { hProperties: { className: ["picture-unseen"] } },
        children: [{ type: "text", value: unseen(node) }],
      });
    });
  };
}

function safelyDecoded(path: string): string {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

function unseen(image: Image): string {
  const drawing = image.url.includes("/ink/");
  const alt = image.alt?.trim() ?? "";
  if (alt === "") return drawing ? DRAWING : PICTURE;
  return (drawing ? DRAWING_NAMED : PICTURE_NAMED).replace("%s", alt);
}

function decorate() {
  return async (tree: HastRoot) => {
    const blocks: Array<{ pre: Element; source: string; language: string }> =
      [];
    visit(tree, "element", (node: Element, index, parent) => {
      if (node.tagName === "a") markLink(node);
      if (node.tagName === "table" && parent && index !== undefined) {
        parent.children[index] = wrapped("div", "table", node);
        return SKIP;
      }
      if (node.tagName !== "pre") return;
      const code = node.children.find(
        (child): child is Element =>
          child.type === "element" && child.tagName === "code",
      );
      const language = code && languageOf(code);
      if (code && language && language !== "math")
        blocks.push({
          pre: node,
          source: textOf(code).replace(/\n$/, ""),
          language,
        });
      return SKIP;
    });
    await Promise.all(
      blocks.map(async ({ pre, source, language }) => {
        if (opensDiagram(language)) {
          Object.assign(pre, {
            tagName: "figure",
            properties: { className: ["diagram"], dataDiagram: language },
            children: [wrapped("pre", "source", codeOf(source))],
          });
          return;
        }
        const coloured = await colouredBlock(source, language).catch(
          () => undefined,
        );
        if (coloured) Object.assign(pre, coloured);
      }),
    );
  };
}

function markLink(a: Element) {
  const href = String(a.properties.href ?? "");
  const named = noteNamed(href);
  const kind = named
    ? "note-link"
    : staysOnPage(href)
      ? "on-page"
      : onTheWeb(href)
        ? "web-link"
        : "elsewhere";
  a.properties.className = [...classesOf(a), kind];
  if (named)
    a.properties.dataNote = "note" in named ? named.note : named.address;
}

function classesOf(node: Element): string[] {
  const held = node.properties.className;
  return Array.isArray(held) ? held.map(String) : [];
}

function languageOf(code: Element): string | undefined {
  const named = classesOf(code).find((name) => name.startsWith("language-"));
  return named?.slice("language-".length);
}

function textOf(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(textOf).join("");
  return "";
}

function codeOf(source: string): Element {
  return {
    type: "element",
    tagName: "code",
    properties: {},
    children: [{ type: "text", value: source }],
  };
}

function wrapped(tagName: string, className: string, inner: Element): Element {
  return {
    type: "element",
    tagName,
    properties: { className: [className] },
    children: [inner],
  };
}
