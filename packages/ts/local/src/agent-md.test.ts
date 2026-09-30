import {
  COMPASS_DIRECTIONS,
  COMPASS_KINDS,
  compassMethod,
  compassOf,
  MARK_RADII,
  NOTE_TEMPLATES,
  OwnedRefSchema,
  parseCodeAnchor,
  RING_STYLES,
  RING_WEIGHTS,
} from "@sloppy/types";
import {
  decodeText,
  emptySidecars,
  encodeText,
  fromMarkdown,
  splitNoteFile,
  toMarkdown,
  vaultToNote,
} from "@sloppy/vault";
import { describe, expect, it } from "vitest";
import {
  AGENT_FILE,
  AGENT_MD,
  agentFile,
  agentFileIsOurs,
  chatBrief,
  keepAgentFile,
  signedAsOurs,
} from "./agent-md.js";
import { type Files, MemoryFiles } from "./files.js";

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

/** Everything under a heading, up to the next one. */
function section(heading: string): string {
  const lines = AGENT_MD.split("\n");
  const at = lines.indexOf(`## ${heading}`);
  expect(at).toBeGreaterThan(-1);
  const after = lines.slice(at + 1);
  const ends = after.findIndex((line) => line.startsWith("## "));
  return (ends === -1 ? after : after.slice(0, ends)).join("\n");
}

/** A section as its sentences read, so a test of what it says does not also
 *  pin where the lines happen to wrap. */
function said(heading: string): string {
  return section(heading).replace(/\s+/g, " ");
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

  /** The number, the look on a line and the look on the mark are the agent's to
   *  write now, so the file teaches them by showing what the reader reads. */
  it("shows a number, a line's look and a mark's look that read back", () => {
    const note = vaultToNote({
      markdown: `${example("One note is one file")}\n`,
    });

    const [drawn] = note.links ?? [];
    expect(OwnedRefSchema.safeParse(drawn).success).toBe(true);
    expect(note.address).toBe("1a1");
    expect(note.edges).toEqual([
      { to: drawn, label: "grew out of", direction: "to", stroke: "dashed" },
    ]);
    expect(note.appearance).toEqual({
      ring_weight: "heavy",
      ring_style: "dashed",
      mark_radius: "large",
    });
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

  it("reads every method in the words the app asks its slots for", () => {
    for (const kind of COMPASS_KINDS) {
      const method = compassMethod(kind);
      expect(AGENT_MD).toContain(`**${method.name}**`);
      for (const direction of COMPASS_DIRECTIONS) {
        const { word, asks } = method.slots[direction];
        expect(AGENT_MD).toContain(`${direction} is **${word}** — ${asks}`);
      }
    }
  });

  it("shows another method that reads back in that method", () => {
    const text = example("The three methods");
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

  /** A look the file leaves unnamed is one the agent never reaches for, so every
   *  value this build draws is taught rather than a chosen few. */
  it("names every look a mark can be drawn with", () => {
    const drawn = section("How a mark is drawn");
    for (const look of [...RING_WEIGHTS, ...RING_STYLES, ...MARK_RADII]) {
      expect(drawn).toContain(`\`${look}\``);
    }
    for (const channel of ["ring_weight", "ring_style", "mark_radius"]) {
      expect(drawn).toContain(`\`${channel}\``);
    }
  });

  it("leaves colour to the reader and gives a tag no look of its own", () => {
    const drawn = section("How a mark is drawn");
    expect(drawn).toContain("A look carries none at any level");
    expect(drawn).toContain("colour arrives when the reader selects tags");
    expect(drawn).toContain("a tag has no look to give it");
  });

  it("marks what it settles for a documenting run as a convention", () => {
    expect(section("How a mark is drawn")).toContain(
      "**A convention for documenting runs.**",
    );
  });

  it("says what the notes are for before it says how to write one", () => {
    expect(AGENT_MD).toContain("what this project is meant to be");
    expect(AGENT_MD).toContain("why it is the way it is");
  });

  // AI.md: the documents come first and the code sprouts from them, so a note
  // written before its code is not a note waiting on anything.
  it("says a note may come before the code it is about", () => {
    expect(AGENT_MD).toContain("the intent the code is answerable to");
    expect(AGENT_MD).toContain(
      "A note whose code does not exist yet is not an unfinished note.",
    );
  });

  it("lets a reason be written from a source the note names, and not otherwise", () => {
    expect(said("The compass")).toContain("a source you name in the note");
    expect(said("The compass")).toContain('"Candidates" heading');
    expect(said("Never write")).toContain(
      'A "west" or a "Why" you cannot name a source for',
    );
  });

  it("leaves saying a note still holds to the person", () => {
    expect(said("Never write")).toContain("`checked`, and `read_against`");
    expect(said("Never write")).toContain("saying it still holds is theirs");
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

describe("what the agent in a chat is told before it hears anybody", () => {
  it("says what the notes are, and where a why is looked up and written", () => {
    const brief = chatBrief();

    expect(brief).toContain("why this project is the way it is");
    expect(brief).toContain("look in the notes before you answer");
    expect(brief).toContain("Told why, write it down there");
  });
});

describe("keeping the file an agent reads current", () => {
  const AT = "/graphs/one/.sloppy";

  function container(): Files {
    return new MemoryFiles().at(AT);
  }

  async function said(files: Files): Promise<string | undefined> {
    const bytes = await files.read(AGENT_FILE);
    return bytes ? decodeText(bytes) : undefined;
  }

  it("writes it where a container has none", async () => {
    const files = container();

    await keepAgentFile(files);

    expect(await said(files)).toBe(agentFile());
  });

  it("writes it again where Sloppy's own rules have moved since", async () => {
    const files = container();
    // The file as an older Sloppy wrote it: its own text, signed by it.
    const older = signedAsOurs(
      AGENT_MD.replace("## One note is one file", "## A note used to be one"),
    );
    await files.write(AGENT_FILE, encodeText(older));

    await keepAgentFile(files);

    expect(await said(files)).toBe(agentFile());
  });

  it("leaves a copy somebody has made their own exactly as it is", async () => {
    const files = container();
    const theirs = `${agentFile()}\nAnd in this project, never touch the vendor folder.\n`;
    await files.write(AGENT_FILE, encodeText(theirs));

    await keepAgentFile(files);

    expect(await said(files)).toBe(theirs);
  });

  it("leaves a file that was never Sloppy's alone", async () => {
    const files = container();
    await files.write(AGENT_FILE, encodeText("Read the wiki.\n"));

    await keepAgentFile(files);

    expect(await said(files)).toBe("Read the wiki.\n");
  });

  it("writes nothing where the file is already what it would write", async () => {
    const files = container();
    await keepAgentFile(files);
    const before = await said(files);

    await keepAgentFile(files);

    expect(await said(files)).toBe(before);
  });

  it("knows its own copy from one that has been changed", () => {
    expect(agentFileIsOurs(agentFile())).toBe(true);
    expect(agentFileIsOurs(`${agentFile()}and one more line\n`)).toBe(false);
    expect(agentFileIsOurs(AGENT_MD)).toBe(false);
  });
});
