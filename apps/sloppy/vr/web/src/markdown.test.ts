import { describe, expect, it } from "vitest";
import {
  MARKDOWN,
  NAMED,
  OTHER_REF,
  PICTURE_DATA,
  PICTURES,
  REF,
} from "./fixtures/note";
import { CITED, DRAWING, tablesJoined, toHtml } from "./markdown";

const page = (html: string) => {
  const holder = document.createElement("div");
  holder.innerHTML = html;
  return holder;
};

describe("a note's markdown as the page shows it", async () => {
  const shown = page(
    await toHtml({ markdown: MARKDOWN, named: NAMED, pictures: PICTURES }),
  );

  it("draws a table as a table, aligned as written", () => {
    const table = shown.querySelector(".table > table");
    expect(table?.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(table?.querySelector("th")?.getAttribute("align")).toBe("right");
    expect(table?.querySelector("td:nth-child(2)")?.textContent?.trim()).toBe(
      "250 g",
    );
  });

  it("colours code in both schemes", () => {
    const pre = shown.querySelector("pre.shiki");
    expect(pre?.textContent).toBe("const ratio = water / coffee;");
    const run = pre?.querySelector("span[style*='--shiki-light']");
    expect(run?.getAttribute("style")).toContain("--shiki-dark");
  });

  it("leaves a diagram's source for the page to draw", () => {
    const figure = shown.querySelector("figure.diagram");
    expect(figure?.getAttribute("data-diagram")).toBe("mermaid");
    expect(figure?.textContent).toContain("Beans --> Grinder --> Kettle");
  });

  it("marks a link to a note by ref and by address, and one out of the graph", () => {
    const [kettle, grind, grinder, web] = shown.querySelectorAll("a");
    expect(kettle.className).toBe("note-link");
    expect(kettle.dataset.note).toBe(REF);
    expect(grind.textContent).toBe("Grind size");
    expect(grind.dataset.note).toBe(OTHER_REF);
    expect(grinder.dataset.note).toBe("1a2");
    expect(web.className).toBe("web-link");
    expect(web.getAttribute("href")).toBe("https://example.com/kettle");
    expect(web.dataset.note).toBeUndefined();
  });

  it("draws a task list, a heading and a quote", () => {
    const boxes = shown.querySelectorAll<HTMLInputElement>(
      ".task-list-item input",
    );
    expect([...boxes].map((box) => box.checked)).toEqual([true, false]);
    expect(shown.querySelector("h2")?.textContent).toBe("Ratios");
    expect(shown.querySelector("blockquote")?.textContent?.trim()).toBe(
      "A quiet cup.",
    );
  });

  it("shows a picture it was given and names one it was not", () => {
    const img = shown.querySelector("img");
    expect(img?.getAttribute("src")).toBe(PICTURE_DATA);
    expect(img?.getAttribute("alt")).toBe("The kettle");
    expect(shown.querySelector(".picture-unseen")?.textContent).toBe(DRAWING);
  });
});

describe("what the page will not carry", () => {
  it("drops markup and scripts the author wrote", async () => {
    const shown = page(
      await toHtml({
        markdown: `<script>alert(1)</script>\n\n[run](javascript:alert(1)) <b onclick="x()">b</b>`,
      }),
    );
    expect(shown.querySelector("script, [onclick]")).toBeNull();
    expect(shown.querySelector("a")?.getAttribute("href")).toBeNull();
  });

  it("fetches no picture from the web", async () => {
    const shown = page(
      await toHtml({ markdown: "![far](https://example.com/far.png)" }),
    );
    expect(shown.querySelector("img")).toBeNull();
    expect(shown.textContent).toBe("Picture: far");
  });

  it("names a cited note it has no title for", async () => {
    const shown = page(await toHtml({ markdown: `[](sloppy:${REF})` }));
    expect(shown.querySelector("a")?.textContent).toBe(CITED);
  });

  it("marks a ref written bare as a link to that note", async () => {
    const shown = page(await toHtml({ markdown: `[kettle](${REF})` }));
    expect(shown.querySelector("a")?.dataset.note).toBe(REF);
  });

  it("leaves a doubled bracket that names no note as written", async () => {
    const shown = page(await toHtml({ markdown: "[[not a note]]" }));
    expect(shown.querySelector("a")).toBeNull();
    expect(shown.textContent).toBe("[[not a note]]");
  });
});

describe("math", () => {
  it("is typeset where a note carries it", async () => {
    const shown = page(await toHtml({ markdown: "Area is $\\pi r^2$." }));
    expect(shown.querySelector(".katex")).not.toBeNull();
  });
});

describe("a table written a row to a paragraph", () => {
  const spread =
    "| Type | Id |\n\n|------|----|\n\n| Ledger | `a1` |\n\n| Currency | `a2` |\n\nAfter.";

  it("is read as one table", async () => {
    const html = await toHtml({ markdown: spread });
    expect(html.match(/<table>/g)).toHaveLength(1);
    expect(html.match(/<tr>/g)).toHaveLength(3);
    expect(html).toContain("<p>After.</p>");
  });

  it("leaves rows in a code fence as written", () => {
    const fenced = "```\n| a | b |\n\n|---|---|\n```";
    expect(tablesJoined(fenced)).toBe(fenced);
  });

  it("leaves pipes that open no table alone", () => {
    const loose = "| just a line |\n\nand prose";
    expect(tablesJoined(loose)).toBe(loose);
  });
});
