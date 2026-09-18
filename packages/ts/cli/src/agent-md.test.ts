import { compassOf, OwnedRefSchema } from "@sloppy/types";
import { emptySidecars, fromMarkdown } from "@sloppy/vault";
import { describe, expect, it } from "vitest";
import { AGENT_MD } from "./agent-md.js";

/** The indented block under a heading, as the file's own code blocks are
 *  written, with the indent taken off. */
function example(heading: string): string {
  const lines = AGENT_MD.split("\n");
  const at = lines.indexOf(`## ${heading}`);
  expect(at).toBeGreaterThan(-1);
  const after = lines.slice(at + 1);
  const next = after.findIndex((line) => line.startsWith("## "));
  return after
    .slice(0, next === -1 ? undefined : next)
    .filter((line) => line.startsWith("    "))
    .map((line) => line.slice(4))
    .join("\n");
}

describe("what AGENT.md teaches", () => {
  it("names notes the way a note file names them", () => {
    const named = AGENT_MD.match(/did:syr:[^\s\]]+/g) ?? [];
    expect(named.length).toBeGreaterThan(0);
    for (const ref of named) {
      expect(OwnedRefSchema.safeParse(ref).success).toBe(true);
    }
  });

  it("shows a compass that reads back as one", () => {
    const document = fromMarkdown(example("The compass"), emptySidecars("b"));
    const compass = compassOf(document);
    expect(compass?.north).toHaveLength(1);
    expect(compass?.south).toHaveLength(2);
    expect(compass?.east).toHaveLength(1);
    expect(compass?.west).toHaveLength(1);
  });
});
