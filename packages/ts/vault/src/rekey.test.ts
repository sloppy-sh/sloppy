import type { BlockView, NodeView } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import {
  decodeText,
  graphFile,
  notePath,
  readGraphFile,
  type Vault,
  VAULT_FORMAT,
} from "./layout.js";
import { noteToVault, vaultToNote } from "./note.js";
import { rekey } from "./rekey.js";

const FROM = "did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE";
const TO = "did:syr:z6MkuANEWERANEWERANEWERANEWERAN";
const GRAPH = "01J000000000000000000000GG";
const NOTE = "01J0000000000000000000000A";
const PARENT = "01J0000000000000000000000B";
const BLOCK = "01J0000000000000000000000C";
const CITED = "01J0000000000000000000000E";

function vault(): Vault {
  const note = {
    ref: `${FROM}/${NOTE}`,
    created_by: FROM,
    depth: 2,
    origin: `${FROM}/${PARENT}`,
    parent: `${FROM}/${PARENT}`,
    address: "1a1",
    title: "A note that names another",
    tags: ["seed"],
    links: [`${FROM}/${CITED}`],
    published: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  } as NodeView;
  const block = {
    ref: `${FROM}/${BLOCK}`,
    created_by: FROM,
    node: `${FROM}/${NOTE}`,
    ord: "a",
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "reference",
              attrs: { note: `${FROM}/${CITED}`, label: "the other" },
            },
            { type: "text", text: ` and ${FROM}/${CITED} in prose` },
          ],
        },
        {
          type: "unheardOf",
          attrs: { note: `${FROM}/${CITED}` },
        },
      ],
    },
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  } as BlockView;
  const { files } = noteToVault(note, ["1a"], [block]);
  files.set(
    "graph.json",
    graphFile({
      format: VAULT_FORMAT,
      graph: GRAPH,
      name: "The garden",
      owner: FROM,
    }),
  );
  return files;
}

describe("a graph moving into another identity", () => {
  const moved = rekey(vault(), FROM, TO);
  const read = vaultToNote({
    markdown: decodeText(moved.get(notePath(NOTE)) as Uint8Array),
  });

  it("keeps the ulid and changes whose it is", () => {
    expect(read.ref).toBe(`${TO}/${NOTE}`);
    expect(read.parent).toBe(`${TO}/${PARENT}`);
    expect(read.links).toEqual([`${TO}/${CITED}`]);
    expect(readGraphFile(moved.get("graph.json") as Uint8Array).owner).toBe(TO);
    expect(readGraphFile(moved.get("graph.json") as Uint8Array).graph).toBe(
      GRAPH,
    );
  });

  it("moves what a section names, and leaves the writing alone", () => {
    const [prose, unheard] = read.sections[0].content.content as {
      type: string;
      attrs?: Record<string, unknown>;
      content?: {
        type: string;
        attrs?: Record<string, unknown>;
        text?: string;
      }[];
    }[];
    expect(prose.content?.[0].attrs?.note).toBe(`${TO}/${CITED}`);
    expect(prose.content?.[1].text).toBe(` and ${FROM}/${CITED} in prose`);
    expect(unheard.attrs?.note).toBe(`${TO}/${CITED}`);
  });

  it("leaves a graph belonging to somebody else alone", () => {
    const held = vault();
    expect(rekey(held, TO, FROM)).toEqual(held);
  });
});
