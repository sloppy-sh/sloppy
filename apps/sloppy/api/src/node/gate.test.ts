// Who gates a note here: what a graph stamps on a note written in it, and what
// a note somebody else gates does to a write — docs/ARCHITECTURE.md § "Whose
// writing a note carries".

import { ForbiddenException } from "@nestjs/common";
import {
  type Address,
  createOwnedRecordId,
  type GraphOwnership,
  type Node,
  type OwnedRef,
  ownedRefFrom,
} from "@sloppy/types";
import { describe, expect, it } from "vitest";
import type { BlockRepository } from "../block/block.repository";
import { BlockService } from "../block/block.service";
import type { MediaService } from "../media/media.service";
import type { PublicationService } from "../publication/publication.service";
import type { FindRepository } from "./find.repository";
import type { GraphRepository } from "./graph.repository";
import { GraphService } from "./graph.service";
import type { NodeRepository } from "./node.repository";
import { NodeService } from "./node.service";

const DID = "did:syr:z6MkAda";
const OTHER = "did:syr:z6MkBram";
const HOME = `${DID}/01ARZ3NDEKTSV4RRFFQ69G5HMM` as OwnedRef;
const AT = "2026-01-01T00:00:00.000Z";
const EMPTY = { type: "doc", content: [] } as const;

const media = {} as MediaService;
const publications = {} as PublicationService;
const finds = {} as FindRepository;

function graphsGating(ownership?: GraphOwnership) {
  return new GraphService({
    home: () => Promise.resolve(HOME),
    find: () =>
      Promise.resolve({ id: "row", ...(ownership ? { ownership } : {}) }),
  } as unknown as GraphRepository);
}

function note(over: Partial<Node> = {}): Node {
  const id = createOwnedRecordId("node", DID);
  return {
    id,
    created_by: DID,
    graph: HOME,
    depth: 1,
    origin: ownedRefFrom(id),
    title: "A note",
    tags: [],
    links: [],
    published: false,
    created_at: AT,
    updated_at: AT,
    ...over,
  } as Node;
}

describe("a graph that gates the notes written in it", () => {
  const writing = (ownership?: GraphOwnership) => {
    const written: Node[] = [];
    const repository = {
      childAddresses: () => Promise.resolve([] as Address[]),
      addressTaken: () => Promise.resolve(null),
      insert: (one: Node) => {
        written.push(one);
        return Promise.resolve(one);
      },
    } as unknown as NodeRepository;
    const service = new NodeService(
      repository,
      finds,
      graphsGating(ownership),
      media,
      publications,
    );
    return { service, written };
  };

  it("stamps the writer on a note written there", async () => {
    const { service, written } = writing("owned");
    await service.create(DID, { title: "Mine", tags: [] });
    expect(written[0].owner).toBe(DID);
  });

  it("stamps nothing on a note written in an open one", async () => {
    const { service, written } = writing();
    await service.create(DID, { title: "Ours", tags: [] });
    expect(written[0].owner).toBeUndefined();
  });
});

describe("a write on a note somebody else gates", () => {
  const gated = note({ owner: OTHER });
  const ref = ownedRefFrom(gated.id);

  const service = (patched: Node[] = []) =>
    new NodeService(
      {
        find: () => Promise.resolve(gated),
        many: () => Promise.resolve([gated]),
        patch: (_did: string, _ref: OwnedRef, changes: object) => {
          const written = { ...gated, ...changes };
          patched.push(written);
          return Promise.resolve(written);
        },
        patchAll: () => Promise.resolve([]),
      } as unknown as NodeRepository,
      finds,
      graphsGating(),
      media,
      publications,
    );

  it("is refused rather than offered, because a note here has one writer", async () => {
    const written = service().update(
      DID,
      ref,
      { title: "Not yours" },
      undefined,
    );
    await expect(written).rejects.toBeInstanceOf(ForbiddenException);
    await expect(written).rejects.toThrow(/Change who owns it/);
  });

  it("lands where the same request takes the gate off", async () => {
    const patched: Node[] = [];
    await service(patched).update(DID, ref, { owner: null }, undefined);
    expect(patched).toHaveLength(1);
  });

  it("is refused for a set of notes where the gate covers all of them", async () => {
    const acted = service().bulk(
      DID,
      { notes: [ref], act: { act: "tag", tags: ["seed"] } },
      undefined,
    );
    await expect(acted).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("a write on a note its own graph gates", () => {
  it("lands, because ownership is not writing", async () => {
    const mine = note({ owner: DID });
    const patched: Node[] = [];
    const service = new NodeService(
      {
        find: () => Promise.resolve(mine),
        patch: (_did: string, _ref: OwnedRef, changes: object) => {
          patched.push({ ...mine, ...changes });
          return Promise.resolve({ ...mine, ...changes });
        },
      } as unknown as NodeRepository,
      finds,
      graphsGating("owned"),
      media,
      publications,
    );
    await service.update(
      DID,
      ownedRefFrom(mine.id),
      { title: "Mine" },
      undefined,
    );
    expect(patched[0].title).toBe("Mine");
  });
});

describe("a section of a note somebody else gates", () => {
  const gated = note({ owner: OTHER });
  const ref = ownedRefFrom(gated.id);
  const section = ownedRefFrom(createOwnedRecordId("block", DID));

  const sections = () =>
    new BlockService(
      {
        nodeOf: () => Promise.resolve(ref),
        listByNode: () => Promise.resolve([]),
        find: () => Promise.resolve(null),
      } as unknown as BlockRepository,
      { find: () => Promise.resolve(gated) } as unknown as NodeRepository,
    );

  it("is not written", async () => {
    await expect(
      sections().create(DID, { node: ref, content: EMPTY }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("is not rewritten", async () => {
    await expect(
      sections().update(DID, section, { content: EMPTY }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("is not taken out", async () => {
    await expect(sections().remove(DID, section)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
