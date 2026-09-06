// The document a copy is written out as, and the reads it is walked by. What
// the SurrealQL beneath those reads actually returns is
// `export.integration.test.ts`.

import {
  addressDepth,
  type Address,
  type Block,
  type DidSyr,
  GraphExportSchema,
  type Node,
  nowIso,
  type OwnedRef,
} from "@sloppy/types";
import { RecordId } from "surrealdb";
import { describe, expect, it } from "vitest";
import type { GraphService } from "../node/graph.service";
import type { ExportRepository } from "./export.repository";
import { ExportService } from "./export.service";

const DID =
  "did:syr:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK" as DidSyr;
const AT = "2026-01-01T00:00:00.000Z";
const HOME = `${DID}/00000000000000000000000000` as OwnedRef;
const OTHER = `${DID}/0000000000000000000000000G` as OwnedRef;

function localId(ref: OwnedRef): string {
  return ref.slice(ref.lastIndexOf("/") + 1);
}

function note(ref: OwnedRef, address: Address, graph: OwnedRef): Node {
  return {
    id: new RecordId("node", { created_by: DID, id: localId(ref) }),
    created_by: DID,
    created_at: AT,
    updated_at: AT,
    graph,
    address,
    depth: addressDepth(address),
    origin: ref,
    title: address,
    tags: [],
    links: [],
    published: false,
  };
}

function section(
  ref: OwnedRef,
  node: OwnedRef,
  ord: string,
  wrote = ord,
): Block {
  return {
    id: new RecordId("block", { created_by: DID, id: localId(ref) }),
    created_by: DID,
    created_at: AT,
    updated_at: AT,
    node,
    ord,
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: wrote }] },
      ],
    },
    text: wrote,
  };
}

/** A store holding one page's worth of rows per graph, answering the keyset
 *  reads the walk is written against. */
function holding(rows: { notes: Node[]; blocks: Block[] }) {
  const asked: string[] = [];
  const refOf = (row: Node | Block) =>
    `${DID}/${(row.id.id as { id: string }).id}` as OwnedRef;

  const repository = {
    notesIn: (
      _did: DidSyr,
      graph: OwnedRef,
      from: string | undefined,
      limit: number,
    ) => {
      asked.push(`notes ${graph} ${from ?? "-"}`);
      return Promise.resolve(
        rows.notes
          .filter((n) => n.graph === graph && (!from || n.address > from))
          .sort((a, b) => (a.address < b.address ? -1 : 1))
          .slice(0, limit),
      );
    },
    noteRefsIn: (
      did: DidSyr,
      graph: OwnedRef,
      from: string | undefined,
      limit: number,
    ) =>
      repository
        .notesIn(did, graph, from, limit)
        .then((page) =>
          page.map((n) => ({ ref: refOf(n), address: n.address })),
        ),
    blocksOf: (
      _did: DidSyr,
      notes: readonly OwnedRef[],
      from: { node: OwnedRef; ord: string } | undefined,
      limit: number,
    ) => {
      asked.push(`blocks ${notes.length}`);
      return Promise.resolve(
        rows.blocks
          .filter((b) => notes.includes(b.node))
          .filter(
            (b) =>
              !from ||
              b.node > from.node ||
              (b.node === from.node && b.ord > from.ord),
          )
          .sort((a, b) =>
            a.node === b.node
              ? a.ord < b.ord
                ? -1
                : 1
              : a.node < b.node
                ? -1
                : 1,
          )
          .slice(0, limit),
      );
    },
  } as unknown as ExportRepository;

  const graphs = {
    list: () =>
      Promise.resolve([
        {
          ref: HOME,
          created_by: DID,
          title: "My graph",
          created_at: AT,
          updated_at: AT,
        },
        {
          ref: OTHER,
          created_by: DID,
          title: "The garden",
          created_at: AT,
          updated_at: AT,
        },
      ]),
  } as unknown as GraphService;

  return { service: new ExportService(graphs, repository), asked };
}

async function written(service: ExportService): Promise<string> {
  let out = "";
  for await (const piece of service.everything(DID)) out += piece;
  return out;
}

describe("a copy of everything somebody keeps", () => {
  it("is one document of their graphs, notes and sections", async () => {
    const first = `${DID}/00000000000000000000000001` as OwnedRef;
    const second = `${DID}/00000000000000000000000002` as OwnedRef;
    const { service } = holding({
      notes: [note(first, "1", HOME), note(second, "1", OTHER)],
      blocks: [
        section(`${DID}/0000000000000000000000000A` as OwnedRef, first, "a0"),
        section(`${DID}/0000000000000000000000000B` as OwnedRef, first, "a1"),
      ],
    });

    const held = GraphExportSchema.parse(JSON.parse(await written(service)));

    expect(held.did).toBe(DID);
    expect(held.graphs.map((g) => g.ref)).toEqual([HOME, OTHER]);
    expect(held.notes.map((n) => n.ref)).toEqual([first, second]);
    expect(held.blocks.map((b) => b.ord)).toEqual(["a0", "a1"]);
    expect(held.blocks.every((b) => b.node === first)).toBe(true);
    expect(Date.parse(held.exported_at)).toBeLessThanOrEqual(
      Date.parse(nowIso()),
    );
  });

  // Asserted against the document itself: parsing it through
  // `GraphExportSchema` would strip the extra column before anything saw it.
  it("carries a section's document and not the words derived from it", async () => {
    const only = `${DID}/00000000000000000000000001` as OwnedRef;
    const { service } = holding({
      notes: [note(only, "1", HOME)],
      blocks: [
        section(
          `${DID}/0000000000000000000000000A` as OwnedRef,
          only,
          "a0",
          "hoopoe",
        ),
      ],
    });

    const document = await written(service);

    expect(document.split("hoopoe").length - 1).toBe(1);
  });

  it("is still one document when there is nothing in it yet", async () => {
    const { service } = holding({ notes: [], blocks: [] });

    const held = GraphExportSchema.parse(JSON.parse(await written(service)));

    expect(held.notes).toEqual([]);
    expect(held.blocks).toEqual([]);
  });

  // Nothing may hold the whole of somebody's writing at once, at either end.
  it("reads a graph a page at a time rather than all of it", async () => {
    const notes = Array.from({ length: 450 }, (_, at) =>
      note(
        `${DID}/${String(at).padStart(26, "0")}` as OwnedRef,
        String(at + 1),
        HOME,
      ),
    );
    const { service, asked } = holding({ notes, blocks: [] });

    const held = GraphExportSchema.parse(JSON.parse(await written(service)));

    const pages = new Set(
      asked.filter((a) => a.startsWith(`notes ${HOME}`)).map((a) => a),
    );
    expect(held.notes.length).toBe(450);
    expect(pages.size).toBe(3);
  });

  it("carries a whole stack, however far past a page it runs", async () => {
    const long = `${DID}/00000000000000000000000001` as OwnedRef;
    const blocks = Array.from({ length: 250 }, (_, at) =>
      section(
        `${DID}/${String(at).padStart(26, "0")}` as OwnedRef,
        long,
        `a${String(at).padStart(4, "0")}`,
      ),
    );
    const { service } = holding({ notes: [note(long, "1", HOME)], blocks });

    const held = GraphExportSchema.parse(JSON.parse(await written(service)));

    expect(held.blocks.length).toBe(250);
    expect(held.blocks[0].ord).toBe("a0000");
    expect(held.blocks[249].ord).toBe("a0249");
  });
});
