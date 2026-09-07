// Closing a graph: what it refuses, and what it sends the notes in it through.

import { BadRequestException } from "@nestjs/common";
import {
  createOwnedRecordId,
  homeGraphRef,
  type Node,
  type OwnedRef,
  ownedRefFrom,
} from "@sloppy/types";
import { describe, expect, it, vi } from "vitest";
import type { MediaService } from "../media/media.service";
import type { PublicationService } from "../publication/publication.service";
import type { FindRepository } from "./find.repository";
import type { GraphRepository } from "./graph.repository";
import { GraphService } from "./graph.service";
import type { NodeRepository } from "./node.repository";
import { NodeService } from "./node.service";

const DID = "did:syr:z6MkAda";
const GARDEN = `${DID}/01ARZ3NDEKTSV4RRFFQ69G5FAV` as OwnedRef;

const media = {} as MediaService;
const finds = {} as FindRepository;

function note(address: string, parent?: OwnedRef): Node {
  const id = createOwnedRecordId("node", DID);
  const ref = ownedRefFrom(id);
  return {
    id,
    created_by: DID,
    address,
    depth: address.length,
    origin: ref,
    graph: GARDEN,
    title: address,
    tags: [],
    links: [],
    published: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...(parent ? { parent } : {}),
  } as unknown as Node;
}

function deletedNote(address: string): Node {
  return {
    ...note(address),
    deleted_at: "2026-01-02T00:00:00.000Z",
  } as unknown as Node;
}

/** A store holding one graph named `GARDEN` with `roots` branches in it, each
 *  one note. */
function holding(roots: Node[]) {
  const rows = {
    find: vi.fn(() => Promise.resolve({ id: "row" })),
    remove: vi.fn(() => Promise.resolve()),
  } as unknown as GraphRepository;
  const graphs = new GraphService(rows);
  const nodes = {
    purgeExpired: vi.fn(() => Promise.resolve()),
    roots: vi.fn(() => Promise.resolve(roots)),
    subtree: vi.fn((_did: string, root: Node) => Promise.resolve([root])),
    remove: vi.fn(() => Promise.resolve()),
    deletedNotes: vi.fn(() => Promise.resolve([] as Node[])),
    findDeleted: vi.fn(() => Promise.resolve(null as Node | null)),
    restore: vi.fn(() => Promise.resolve()),
  } as unknown as NodeRepository;
  const publications = {
    rootedIn: vi.fn(() => Promise.resolve([])),
    remove: vi.fn(() => Promise.resolve()),
  } as unknown as PublicationService;
  return {
    rows,
    nodes,
    publications,
    service: new NodeService(nodes, finds, graphs, media, publications),
  };
}

describe("closing a graph", () => {
  it("sends every note in it the way a deleted branch goes", async () => {
    const branches = [note("1"), note("2")];
    const { service, nodes, rows } = holding(branches);

    await service.closeGraph(DID, GARDEN, undefined);

    expect(nodes.remove).toHaveBeenCalledWith(DID, branches);
    expect(rows.remove).toHaveBeenCalledWith(DID, GARDEN);
  });

  it("takes down what the notes in it were publishing before they go", async () => {
    const branch = note("1");
    const { service, publications, nodes } = holding([branch]);
    const chain = { publication: `${DID}/01ARZ3NDEKTSV4RRFFQ69G5FAW` };
    vi.mocked(publications.rootedIn).mockResolvedValue([
      chain,
    ] as unknown as never);
    const order: string[] = [];
    vi.mocked(publications.remove).mockImplementation(() => {
      order.push("taken down");
      return Promise.resolve() as never;
    });
    vi.mocked(nodes.remove).mockImplementation(() => {
      order.push("gone");
      return Promise.resolve();
    });

    await service.closeGraph(DID, GARDEN, {
      did: DID,
      token: "a-token",
    } as never);

    expect(order).toEqual(["taken down", "gone"]);
  });

  it("refuses the graph somebody started with, in words, and leaves it alone", async () => {
    const { service, nodes, rows } = holding([note("1")]);

    const closing = service.closeGraph(DID, homeGraphRef(DID), undefined);

    await expect(closing).rejects.toBeInstanceOf(BadRequestException);
    await expect(closing).rejects.toThrow(/started with stays/);
    expect(nodes.remove).not.toHaveBeenCalled();
    expect(rows.remove).not.toHaveBeenCalled();
  });

  it("refuses a graph that is not theirs, and leaves its notes alone", async () => {
    const { service, rows, nodes } = holding([note("1")]);
    vi.mocked(rows.find).mockResolvedValue(null);

    await expect(
      service.closeGraph(DID, GARDEN, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(nodes.remove).not.toHaveBeenCalled();
    expect(rows.remove).not.toHaveBeenCalled();
  });

  it("leaves the notes that were in it out of what can be put back", async () => {
    const gone = deletedNote("1");
    const { service, nodes, rows } = holding([]);
    vi.mocked(nodes.deletedNotes).mockResolvedValue([gone]);

    expect(await service.deleted(DID)).toHaveLength(1);

    vi.mocked(rows.find).mockResolvedValue(null);
    expect(await service.deleted(DID)).toEqual([]);
  });

  it("refuses to put one of them back, so none comes back to nowhere", async () => {
    const gone = deletedNote("1");
    const { service, nodes, rows } = holding([]);
    vi.mocked(nodes.findDeleted).mockResolvedValue(gone);
    vi.mocked(rows.find).mockResolvedValue(null);

    await expect(service.restore(DID, ownedRefFrom(gone.id))).rejects.toThrow(
      /not here to put back/,
    );
    expect(nodes.restore).not.toHaveBeenCalled();
  });

  // Somebody else's ref is not theirs to close however it is spelled.
  it("refuses a graph belonging to another person", async () => {
    const { service, rows } = holding([]);

    await expect(
      service.closeGraph(
        DID,
        "did:syr:z6MkBob/01ARZ3NDEKTSV4RRFFQ69G5FAV" as OwnedRef,
        undefined,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(rows.remove).not.toHaveBeenCalled();
  });
});
