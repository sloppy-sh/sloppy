// Who gates a note here: what a graph stamps on a note written in it, and what
// a note somebody else gates does to a write — docs/ARCHITECTURE.md § "Whose
// writing a note carries".

import { ForbiddenException } from "@nestjs/common";
import {
  type Address,
  type BlockDocument,
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
const COMMIT = "9c6eb7e0f1a24c3b5d6e7f8091a2b3c4d5e6f708";
const EMPTY: BlockDocument = { type: "doc", content: [] };

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

  it("is refused a confirmation too, which is a write on its row", async () => {
    const patched: Node[] = [];
    const written = service(patched).update(
      DID,
      ref,
      { checked: COMMIT },
      undefined,
    );
    await expect(written).rejects.toBeInstanceOf(ForbiddenException);
    expect(patched).toEqual([]);
  });

  it("is refused where the request taking the gate off also writes", async () => {
    const patched: Node[] = [];
    const written = service(patched).update(
      DID,
      ref,
      { owner: null, title: "Not yours yet" },
      undefined,
    );
    await expect(written).rejects.toBeInstanceOf(ForbiddenException);
    expect(patched).toEqual([]);
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

/** Every row an act here reaches is scoped by `created_by`, so the person
 *  carrying a subtree is the graph's own owner, whose place acts every note in
 *  it is held to whatever its gate says. */
describe("a branch holding a note somebody else gates", () => {
  const branch = note();
  const beneath = note({ owner: OTHER, depth: 2 });

  it("is taken out by the graph's own owner, gated note and all", async () => {
    const removed: Node[][] = [];
    const service = new NodeService(
      {
        purgeExpired: () => Promise.resolve(),
        find: () => Promise.resolve(branch),
        subtree: () => Promise.resolve([branch, beneath]),
        remove: (_did: string, going: Node[]) => {
          removed.push(going);
          return Promise.resolve();
        },
      } as unknown as NodeRepository,
      finds,
      graphsGating(),
      media,
      { rootedIn: () => Promise.resolve([]) } as unknown as PublicationService,
    );

    await service.remove(DID, ownedRefFrom(branch.id), undefined);

    expect(removed[0]).toEqual([branch, beneath]);
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

describe("a write on an open note somebody else's writing is in", () => {
  const open = note({ authors: [OTHER] });
  const ref = ownedRefFrom(open.id);

  const patching = () => {
    const written: Record<string, unknown>[] = [];
    const service = new NodeService(
      {
        find: () => Promise.resolve(open),
        patch: (
          _did: string,
          _ref: OwnedRef,
          changes: Record<string, unknown>,
        ) => {
          written.push(changes);
          return Promise.resolve({ ...open, ...changes });
        },
      } as unknown as NodeRepository,
      finds,
      graphsGating(),
      media,
      publications,
    );
    return { service, written };
  };

  it("joins the writer to what the note carries", async () => {
    const { service, written } = patching();
    await service.update(DID, ref, { title: "Also mine" }, undefined);
    expect(written[0].authors).toEqual([OTHER, DID]);
  });

  it("joins nobody where the request only hands the gate on", async () => {
    const { service, written } = patching();
    await service.update(DID, ref, { owner: OTHER }, undefined);
    expect(written[0]).not.toHaveProperty("authors");
  });

  it("joins nobody where the request only confirms it still holds", async () => {
    const { service, written } = patching();
    await service.update(DID, ref, { checked: COMMIT }, undefined);
    expect(written[0].checked).toBe(COMMIT);
    expect(written[0]).not.toHaveProperty("authors");
  });

  it("joins the writer where the same request also writes", async () => {
    const { service, written } = patching();
    await service.update(
      DID,
      ref,
      { checked: COMMIT, title: "Confirmed and renamed" },
      undefined,
    );
    expect(written[0].authors).toEqual([OTHER, DID]);
  });

  it("joins nobody where the request only says what it was read against", async () => {
    const { service, written } = patching();
    const readings = [{ path: "src/a.ts", digest: `sha256:${"a".repeat(64)}` }];
    const held = await service.update(
      DID,
      ref,
      { read_against: readings },
      undefined,
    );
    expect(written[0].read_against).toEqual(readings);
    expect(written[0]).not.toHaveProperty("authors");
    expect(held.read_against).toEqual(readings);
  });
});

describe("an act over a set of open notes", () => {
  it("joins whoever made it to each of them, as a single write does", async () => {
    const ours = note({ authors: [OTHER] });
    // A note whose list is the ref's own owner alone is already carrying them, and
    // spelling it out would be a second way to write the same note.
    const mine = note();
    const writes: Record<string, unknown>[] = [];
    const service = new NodeService(
      {
        many: () => Promise.resolve([ours, mine]),
        patchAll: (
          _did: string,
          changes: ReadonlyMap<OwnedRef, Record<string, unknown>>,
        ) => {
          writes.push(...changes.values());
          return Promise.resolve([ours, mine]);
        },
      } as unknown as NodeRepository,
      finds,
      graphsGating(),
      media,
      publications,
    );

    await service.bulk(
      DID,
      {
        notes: [ownedRefFrom(ours.id), ownedRefFrom(mine.id)],
        act: { act: "tag", tags: ["seed"] },
      },
      undefined,
    );

    expect(writes.map((one) => one.authors)).toEqual([[OTHER, DID], undefined]);
  });

  it("joins nobody to one its own graph gates, because ownership is not writing", async () => {
    const owned = note({ owner: DID, authors: [OTHER] });
    const writes: Record<string, unknown>[] = [];
    const service = new NodeService(
      {
        many: () => Promise.resolve([owned]),
        patchAll: (
          _did: string,
          changes: ReadonlyMap<OwnedRef, Record<string, unknown>>,
        ) => {
          writes.push(...changes.values());
          return Promise.resolve([owned]);
        },
      } as unknown as NodeRepository,
      finds,
      graphsGating("owned"),
      media,
      publications,
    );

    await service.bulk(
      DID,
      { notes: [ownedRefFrom(owned.id)], act: { act: "tag", tags: ["seed"] } },
      undefined,
    );

    expect(writes[0]).not.toHaveProperty("authors");
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
