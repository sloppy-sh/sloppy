import { describe, expect, it } from "vitest";
import { UpdateBlockRequestSchema } from "./block.js";

const DID = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva";
const NOTE = `${DID}/01JBNKNTE00000000000000000`;
const SECTION = `${DID}/01JBSECTN00000000000000000`;
const AT = "2026-01-01T00:00:00.000Z";

const words = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "A line" }] }],
};

describe("writing a section", () => {
  it("leaves it in the note it is in where nothing names one", () => {
    const asked = UpdateBlockRequestSchema.parse({ content: words });
    expect(asked.node).toBeUndefined();
    expect(asked.after).toBeUndefined();
  });

  it("still takes every shape written before a note could be named", () => {
    expect(
      UpdateBlockRequestSchema.parse({ after: null, expects: AT }),
    ).toMatchObject({ after: null, expects: AT });
    expect(UpdateBlockRequestSchema.parse({ after: SECTION })).toMatchObject({
      after: SECTION,
    });
    expect(UpdateBlockRequestSchema.parse({})).toEqual({});
  });
});

describe("carrying a section into another note", () => {
  it("names the note it belongs to afterwards and the section it follows", () => {
    expect(
      UpdateBlockRequestSchema.parse({ node: NOTE, after: SECTION }),
    ).toMatchObject({ node: NOTE, after: SECTION });
  });

  it("takes it to the top of the note it arrives in", () => {
    expect(
      UpdateBlockRequestSchema.parse({ node: NOTE, after: null }),
    ).toMatchObject({ node: NOTE, after: null });
    expect(
      UpdateBlockRequestSchema.parse({ node: NOTE }).after,
    ).toBeUndefined();
  });

  it("carries the writing and the precondition with it", () => {
    expect(
      UpdateBlockRequestSchema.parse({
        node: NOTE,
        after: null,
        content: words,
        expects: AT,
      }),
    ).toMatchObject({ node: NOTE, expects: AT });
  });

  it("refuses a note that is not a <did>/<ulid>", () => {
    expect(() => UpdateBlockRequestSchema.parse({ node: DID })).toThrow();
    expect(() =>
      UpdateBlockRequestSchema.parse({ node: `${DID}/not-a-ulid` }),
    ).toThrow();
    expect(() => UpdateBlockRequestSchema.parse({ node: null })).toThrow();
  });
});
