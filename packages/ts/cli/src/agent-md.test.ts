import {
  compassOf,
  NOTE_TEMPLATES,
  OwnedRefSchema,
  parseCodeAnchor,
} from "@sloppy/types";
import {
  emptySidecars,
  fromMarkdown,
  splitNoteFile,
  toMarkdown,
} from "@sloppy/vault";
import { describe, expect, it } from "vitest";
import { AGENT_MD } from "./agent-md.js";

/** The first indented block under a heading, as the file's own examples are
 *  written, with the indent taken off and the blank lines inside it kept. */
function example(heading: string): string {
  const lines = AGENT_MD.split("\n");
  const at = lines.indexOf(`## ${heading}`);
  expect(at).toBeGreaterThan(-1);
  const after = lines.slice(at + 1);
  const opens = after.findIndex((line) => line.startsWith("    "));
  expect(opens).toBeGreaterThan(-1);
  const block: string[] = [];
  for (const line of after.slice(opens)) {
    if (!line.startsWith("    ") && line !== "") break;
    block.push(line.slice(4));
  }
  while (block[block.length - 1] === "") block.pop();
  return block.join("\n");
}

describe("what AGENT.md teaches", () => {
  it("names notes the way a note file names them", () => {
    const named = AGENT_MD.match(/did:syr:[^\s"\]]+/g) ?? [];
    expect(named.length).toBeGreaterThan(0);
    for (const ref of named) {
      expect(OwnedRefSchema.safeParse(ref).success).toBe(true);
    }
  });

  it("shows front matter that splits as a note file's", () => {
    const { front, body } = splitNoteFile(
      `${example("One note is one file")}\n`,
    );
    expect(front.get("title")).toBe("What the markdown reader does");
    expect(front.get("tags")).toEqual([{ plain: "parsing" }]);
    expect(OwnedRefSchema.safeParse(front.get("ref")).success).toBe(true);
    expect(body).toEqual([""]);
  });

  it("shows writing that reads back and writes back unchanged", () => {
    const text = example("What a section can hold");
    const document = fromMarkdown(text, emptySidecars("b"));
    expect(toMarkdown(document, emptySidecars("b"))).toBe(text);
    expect((document.content ?? []).map((node) => node.type)).toEqual([
      "heading",
      "paragraph",
      "taskList",
      "codeBlock",
    ]);
  });

  it("shows anchors that point into a project", () => {
    for (const line of example("Pointing at code").split("\n")) {
      const href = /\]\((.+)\)$/.exec(line)?.[1];
      expect(parseCodeAnchor(href ?? "")?.path).toBe(
        "packages/ts/vault/src/markdown.ts",
      );
    }
  });

  it("shows a compass that reads back as one", () => {
    const document = fromMarkdown(example("The compass"), emptySidecars("b"));
    const compass = compassOf(document);
    expect(compass?.north).toHaveLength(1);
    expect(compass?.south).toHaveLength(2);
    expect(compass?.east).toHaveLength(1);
    expect(compass?.west).toHaveLength(1);
    expect(compass?.kind).toBeUndefined();
  });

  it("shows another method that reads back in that method", () => {
    const text = example("Reading a compass another way");
    const document = fromMarkdown(text, emptySidecars("b"));
    expect(toMarkdown(document, emptySidecars("b"))).toBe(text);
    const compass = compassOf(document);
    expect(compass?.kind).toBe("inquiry");
    expect(compass?.north).toHaveLength(1);
    expect(compass?.south).toHaveLength(0);
  });

  it("teaches both emoji forms, and the reader reads each as it says", () => {
    const forms = [...AGENT_MD.matchAll(/`(::?)wave\1`/g)].map((found) =>
      found[0].slice(1, -1),
    );
    expect(forms).toEqual([":wave:", "::wave::"]);
    for (const [form, sticker] of [
      [forms[0], undefined],
      [forms[1], true],
    ] as const) {
      const document = fromMarkdown(form, emptySidecars("b"));
      const emoji = document.content?.[0]?.content?.[0];
      expect(emoji?.type).toBe("emoji");
      expect(emoji?.attrs?.name).toBe("wave");
      expect(emoji?.attrs?.sticker).toBe(sticker);
    }
  });

  it("carries every shape the app starts a note from", () => {
    for (const shape of NOTE_TEMPLATES) {
      expect(AGENT_MD).toContain(`**${shape.name}**`);
      for (const section of shape.sections) {
        expect(AGENT_MD).toContain(section.heading);
      }
    }
  });
});
