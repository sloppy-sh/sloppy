import type { AmendmentView, BlockView, NodeView } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import { amendmentToVault, vaultToAmendment } from "./amendment.js";
import {
  amendmentPath,
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
const OFFER = "01J0000000000000000000000F";
const WHOSE = "01J0000000000000000000000G";
const PROPOSER = "did:syr:z6MkwProposerProposerProposer";

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
            {
              type: "text",
              text: "and a link to it",
              marks: [
                {
                  type: "link",
                  attrs: { href: `sloppy:${FROM}/${CITED}` },
                },
              ],
            },
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
        marks?: { type: string; attrs?: Record<string, unknown> }[];
      }[];
    }[];
    expect(prose.content?.[0].attrs?.note).toBe(`${TO}/${CITED}`);
    expect(prose.content?.[1].text).toBe(` and ${FROM}/${CITED} in prose`);
    expect(prose.content?.[2].marks?.[0].attrs?.href).toBe(
      `sloppy:${TO}/${CITED}`,
    );
    expect(unheard.attrs?.note).toBe(`${TO}/${CITED}`);
  });

  it("leaves a graph belonging to somebody else alone", () => {
    const held = vault();
    expect(rekey(held, TO, FROM)).toEqual(held);
  });

  it("moves the note an offer amends and leaves the people alone", () => {
    const held = vault();
    const { files } = amendmentToVault({
      ref: `${FROM}/${OFFER}`,
      created_by: FROM,
      note: `${FROM}/${NOTE}`,
      by: PROPOSER,
      at: "2026-02-01T00:00:00.000Z",
      title: "As I would have it",
      tags: [],
      blocks: [],
      created_at: "2026-02-01T00:00:00.000Z",
      updated_at: "2026-02-01T00:00:00.000Z",
    } as AmendmentView);
    for (const [path, bytes] of files) held.set(path, bytes);
    const whose = noteToVault(
      {
        ref: `${FROM}/${WHOSE}`,
        created_by: FROM,
        depth: 1,
        origin: `${FROM}/${WHOSE}`,
        title: "A note somebody else has written into",
        tags: [],
        links: [],
        owner: FROM,
        authors: [FROM, PROPOSER],
        contributors: [PROPOSER],
        published: false,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      } as NodeView,
      [],
      [],
    );
    for (const [path, bytes] of whose.files) held.set(path, bytes);

    const carried = rekey(held, FROM, TO);
    const offered = vaultToAmendment({
      markdown: decodeText(carried.get(amendmentPath(OFFER)) as Uint8Array),
    });
    expect(offered.amends).toBe(`${TO}/${NOTE}`);
    // Whose writing it is, is a person. Importing a graph does not change one.
    expect(offered.by).toBe(PROPOSER);

    const written = vaultToNote({
      markdown: decodeText(carried.get(notePath(WHOSE)) as Uint8Array),
    });
    expect(written.owner).toBe(FROM);
    expect(written.authors).toEqual([FROM, PROPOSER]);
    expect(written.contributors).toEqual([PROPOSER]);
  });
});
