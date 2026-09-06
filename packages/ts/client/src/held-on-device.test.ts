// The wire for what a person can get back and take away: the branches they
// deleted, putting one back, a copy of everything, and the precondition that
// stops one device replacing what another wrote.

import type { BlockView, NodeView } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import { SloppyClient } from "./index.js";

const DID = "did:syr:z6MkAdaAdaAdaAdaAdaAdaAdaAdaAdaAda";
const NOTE = `${DID}/01JNTE00000000000000000000`;
const SECTION = `${DID}/01JBCK00000000000000000000`;
const GRAPH = `${DID}/00000000000000000000000000`;
const AT = "2026-03-01T00:00:00.000Z";

interface Asked {
  method: string;
  path: string;
  body: unknown;
}

function watching(answer: unknown, status = 200) {
  const asked: Asked[] = [];
  const client = new SloppyClient({
    fetch: async (input, init) => {
      asked.push({
        method: init?.method ?? "GET",
        path: new URL(String(input), "http://sloppy.test").pathname,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return new Response(JSON.stringify(answer), {
        status,
        headers: { "content-type": "application/json" },
      });
    },
  });
  return { client, asked };
}

const note: NodeView = {
  ref: NOTE,
  created_by: DID,
  graph: GRAPH,
  address: "1",
  depth: 1,
  origin: NOTE,
  title: "Back again",
  tags: [],
  links: [],
  published: false,
  created_at: AT,
  updated_at: AT,
};

const section: BlockView = {
  ref: SECTION,
  created_by: DID,
  node: NOTE,
  ord: "a0",
  content: { type: "doc", content: [] },
  created_at: AT,
  updated_at: AT,
};

describe("the branches a person can still put back", () => {
  it("reads them with the size of what comes back", async () => {
    const { client, asked } = watching([
      {
        ref: NOTE,
        address: "1a",
        graph: GRAPH,
        title: "A branch that went",
        deleted_at: AT,
        notes: 12,
      },
    ]);

    const branches = await client.deletedBranches();

    expect(asked[0]).toMatchObject({
      method: "GET",
      path: "/api/nodes/deleted",
    });
    expect(branches[0]).toMatchObject({ address: "1a", notes: 12 });
  });

  it("puts one back by the note it is rooted at", async () => {
    const { client, asked } = watching(note);

    await expect(client.restoreBranch(NOTE)).resolves.toMatchObject({
      address: "1",
    });
    expect(asked[0].method).toBe("POST");
    expect(asked[0].path).toBe(
      `/api/nodes/${encodeURIComponent(DID)}/01JNTE00000000000000000000/restore`,
    );
  });
});

describe("a copy of everything", () => {
  it("carries the graphs, the notes and every section of them", async () => {
    const { client, asked } = watching({
      exported_at: AT,
      did: DID,
      graphs: [
        {
          ref: GRAPH,
          created_by: DID,
          title: "My graph",
          created_at: AT,
          updated_at: AT,
        },
      ],
      notes: [note],
      blocks: [section],
    });

    const held = await client.exportEverything();

    expect(asked[0]).toMatchObject({ method: "GET", path: "/api/export" });
    expect(held.notes[0].address).toBe("1");
    expect(held.blocks[0].node).toBe(NOTE);
  });
});

describe("writing a section", () => {
  it("carries the moment the writer last saw it, where it has one", async () => {
    const { client, asked } = watching(section);

    await client.updateBlock(SECTION, { content: section.content });
    await client.updateBlock(SECTION, {
      content: section.content,
      expects: AT,
    });

    expect(asked[0].body).not.toHaveProperty("expects");
    expect(asked[1].body).toMatchObject({ expects: AT });
  });
});
