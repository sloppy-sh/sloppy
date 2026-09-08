// The wire for arranging a note's sections: where one sits in its stack, and
// which note it belongs to.

import type { BlockView } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import { SloppyClient } from "./index.js";

const DID = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva";
const NOTE = `${DID}/01JBNKNTE00000000000000000`;
const OTHER = `${DID}/01JBNKTHER0000000000000000`;
const SECTION = `${DID}/01JBSECTN00000000000000000`;
const FOLLOWS = `${DID}/01JBSECTNB0000000000000000`;
const AT = "2026-04-01T00:00:00.000Z";

function watching(answer: BlockView) {
  const asked: { method: string; path: string; body: unknown }[] = [];
  const client = new SloppyClient({
    fetch: async (input, init) => {
      asked.push({
        method: init?.method ?? "GET",
        path: new URL(String(input), "http://sloppy.test").pathname,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return new Response(JSON.stringify(answer), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  return { client, asked };
}

const carried: BlockView = {
  ref: SECTION,
  created_by: DID,
  node: OTHER,
  ord: "a0",
  content: { type: "doc", content: [] },
  created_at: AT,
  updated_at: AT,
};

describe("carrying a section into another note", () => {
  it("names the note it belongs to afterwards, and answers with it there", async () => {
    const { client, asked } = watching(carried);

    const written = await client.updateBlock(SECTION, {
      node: OTHER,
      after: FOLLOWS,
    });

    expect(asked[0]).toMatchObject({
      method: "PATCH",
      path: `/api/blocks/${encodeURIComponent(DID)}/01JBSECTN00000000000000000`,
      body: { node: OTHER, after: FOLLOWS },
    });
    expect(written.node).toBe(OTHER);
  });

  it("takes it to the top of the note it arrives in", async () => {
    const { client, asked } = watching(carried);

    await client.updateBlock(SECTION, { node: OTHER, after: null });

    expect(asked[0].body).toEqual({ node: OTHER, after: null });
  });

  it("names no note for a section that only moves within its own", async () => {
    const { client, asked } = watching({ ...carried, node: NOTE });

    await client.updateBlock(SECTION, { after: null });

    expect(asked[0].body).not.toHaveProperty("node");
  });
});
