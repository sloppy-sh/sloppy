// The one refusal the number line itself forces, which of the notes somebody
// deleted a listing offers back, what an address typed into a search reaches,
// and what carrying a note somewhere else re-addresses and refuses. Everything
// else about writing a note is exercised against a running server in
// `domain.integration.test.ts`; the number-line refusal cannot live there,
// because reaching the top means owning a branch numbered near it and every
// automatic branch that graph opened afterwards would follow that number rather
// than its own.

import { BadRequestException, NotFoundException } from "@nestjs/common";
import {
  type Address,
  addressDepth,
  createOwnedRecordId,
  DELETED_KEPT_FOR_DAYS,
  type Node,
  type NodeAlias,
  type NoteDestination,
  type OwnedRef,
  ownedRefFrom,
  homeGraphRef,
  siblingAddress,
} from "@sloppy/types";
import { describe, expect, it } from "vitest";
import type { MediaService } from "../media/media.service";
import type { PublicationService } from "../publication/publication.service";
import type { FindRepository } from "./find.repository";
import type { GraphRepository } from "./graph.repository";
import { GraphService } from "./graph.service";
import type { NodeRepository } from "./node.repository";
import { NodeService } from "./node.service";

/** Nothing here reaches a picture, so the store is never asked for one. */
const media = {} as MediaService;
/** Nor publishes anything. */
const publications = {} as PublicationService;
/** Nothing here names a graph, so every note is in the home graph — the one
 *  graph {@link GraphService} answers for without a read. */
const graphs = new GraphService({} as GraphRepository);
/** Nor finds a note by what it says. */
const finds = {} as FindRepository;

describe("a branch the server numbers", () => {
  it("is refused in words when nothing could follow the highest one", async () => {
    const highest = String(Number.MAX_SAFE_INTEGER - 1) as Address;
    const repository = {
      childAddresses: () => Promise.resolve([highest]),
    } as unknown as NodeRepository;

    const written = new NodeService(
      repository,
      finds,
      graphs,
      media,
      publications,
    ).create("did:syr:z6MkAda", {
      title: "",
      tags: [],
    });

    await expect(written).rejects.toBeInstanceOf(BadRequestException);
    await expect(written).rejects.toThrow(/Number a lower one/);
  });
});

const DID = "did:syr:z6MkAda";
const AT = "2026-01-01T00:00:00.000Z";
const EARLIER = "2025-12-01T00:00:00.000Z";

/** One deleted note of a tree rooted at `origin`, or at itself where none is
 *  named. */
function gone(
  address: string,
  at: string,
  over: Partial<Node> = {},
): Node & { ref: string } {
  const id = createOwnedRecordId("node", DID);
  const ref = ownedRefFrom(id);
  return {
    id,
    ref,
    created_by: DID,
    address,
    depth: address.length,
    origin: ref,
    title: address,
    tags: [],
    links: [],
    published: false,
    deleted_at: at,
    created_at: AT,
    updated_at: AT,
    ...over,
  } as Node & { ref: string };
}

function listing(notes: readonly (Node & { ref: string })[]) {
  const repository = {
    purgeExpired: () => Promise.resolve([]),
    deletedNotes: () => Promise.resolve([...notes]),
  } as unknown as NodeRepository;
  return new NodeService(
    repository,
    finds,
    graphs,
    media,
    publications,
  ).deleted(DID);
}

describe("the branches somebody can still put back", () => {
  it("names each deleted branch once, with everything that went with it", async () => {
    const root = gone("1", AT);
    const under = gone("1a", AT, { origin: root.ref, parent: root.ref });
    const deeper = gone("1a1", AT, { origin: root.ref, parent: under.ref });

    const branches = await listing([root, under, deeper]);

    expect(branches).toEqual([
      {
        ref: root.ref,
        address: "1",
        graph: `${DID}/00000000000000000000000000`,
        title: "1",
        deleted_at: AT,
        notes: 3,
      },
    ]);
  });

  it("holds a note deleted earlier back until the branch above it is here", async () => {
    const root = gone("1", AT);
    const under = gone("1a", EARLIER, { origin: root.ref, parent: root.ref });

    expect(
      (await listing([root, under])).map((branch) => [
        branch.address,
        branch.notes,
      ]),
    ).toEqual([["1", 1]]);
    expect((await listing([under])).map((branch) => branch.address)).toEqual([
      "1a",
    ]);
  });

  it("puts what went most recently first", async () => {
    const older = gone("1", EARLIER);
    const newer = gone("2", AT);

    const branches = await listing([older, newer]);

    expect(branches.map((branch) => branch.address)).toEqual(["2", "1"]);
  });
});

describe("the window closing on everybody at once", () => {
  it("purges each person past it, against the one moment", async () => {
    const purged: { did: string; before: string }[] = [];
    const repository = {
      authorsPast: () => Promise.resolve([DID, "did:syr:z6MkBram"]),
      purgeExpired: (did: string, before: string) => {
        purged.push({ did, before });
        return Promise.resolve();
      },
    } as unknown as NodeRepository;

    const swept = await new NodeService(
      repository,
      finds,
      graphs,
      media,
      publications,
    ).sweepEveryone();

    expect(swept).toBe(2);
    expect(purged.map((one) => one.did)).toEqual([DID, "did:syr:z6MkBram"]);
    expect(new Set(purged.map((one) => one.before)).size).toBe(1);
    const kept = Date.now() - Date.parse(purged[0].before);
    expect(kept / (24 * 60 * 60 * 1000)).toBeCloseTo(DELETED_KEPT_FOR_DAYS, 3);
  });
});

const HOME = `${DID}/00000000000000000000000000`;

/** One note that is there, of a tree rooted at `origin` or at itself. */
function live(
  address: string,
  over: Partial<Node> = {},
): Node & { ref: OwnedRef } {
  const id = createOwnedRecordId("node", DID);
  const ref = ownedRefFrom(id);
  return {
    id,
    ref,
    created_by: DID,
    address,
    depth: addressDepth(address as Address),
    origin: ref,
    title: address,
    tags: [],
    links: [],
    published: false,
    created_at: AT,
    updated_at: AT,
    ...over,
  } as Node & { ref: OwnedRef };
}

/** One note its author never numbered. */
function unnumbered(
  title: string,
  over: Partial<Node> = {},
): Node & { ref: OwnedRef } {
  const { address: _left, ...rest } = live("1", { title, ...over });
  return rest as Node & { ref: OwnedRef };
}

/**
 * The reads a move and a creation make over one person's notes, and the writes
 * they ask for, applied so a later read sees them. `landing` holds a move
 * between the addresses it read and the row it writes.
 */
function notebook(
  notes: readonly (Node & { ref: OwnedRef })[],
  landing: Promise<void> = Promise.resolve(),
  /** What the graph has spent on notes that are not among `notes`: addresses
   *  they were carried away from, and ones a purge retired. */
  spentAlready: {
    aliases?: readonly NodeAlias[];
    retired?: readonly Address[];
  } = {},
) {
  const asked: {
    landed: Node[];
    aliases: NodeAlias[];
    /** What each note in the bin gave up, and the alias it kept where it wrote
     *  one. */
    yielded: { from: OwnedRef; alias?: Address }[];
  } = {
    landed: [],
    aliases: [],
    yielded: [],
  };
  const held: Node[] = notes.map((one) => ({ ...one }));
  /** Every address a note has been carried or renamed away from. */
  const left: NodeAlias[] = [...(spentAlready.aliases ?? [])];
  const retired = new Set<Address>(spentAlready.retired ?? []);
  const there = () => held.filter((one) => one.deleted_at === undefined);
  /** What the unique index on the store's notes answers, and refuses a write
   *  against. The one over the addresses they were carried away from is its
   *  own index: nothing in the store spans the two. */
  const spent = (address: Address, of?: OwnedRef) =>
    held.some((one) => one.address === address && ownedRefFrom(one.id) !== of);
  /** The parent chain, which is what the store's own read walks. */
  const under = (root: Node, from: readonly Node[]) => {
    const byRef = new Map(from.map((one) => [ownedRefFrom(one.id), one]));
    const springs = (one: Node): boolean => {
      for (let walk: Node | undefined = one; walk !== undefined; ) {
        if (ownedRefFrom(walk.id) === ownedRefFrom(root.id)) return true;
        walk = walk.parent === undefined ? undefined : byRef.get(walk.parent);
      }
      return false;
    };
    return from.filter(springs);
  };
  /** What `node_alias_owner_graph_address` allows: one alias per address, and
   *  a write of a second is what the store refuses. */
  const leadBack = (alias: NodeAlias) => {
    if (left.some((one) => one.address === alias.address)) {
      throw new Error(`${alias.address} is already led back by`);
    }
    left.push(alias);
  };
  /** A note in the bin handing its address over: the row loses it and the alias
   *  the service wrote keeps it leading there. */
  const yieldUp = (
    giving: readonly { from: Node; alias?: NodeAlias }[] = [],
  ) => {
    for (const one of giving) {
      asked.yielded.push({
        from: ownedRefFrom(one.from.id),
        ...(one.alias ? { alias: one.alias.address } : {}),
      });
      if (one.alias) leadBack(one.alias);
      const at = held.findIndex(
        (was) => ownedRefFrom(was.id) === ownedRefFrom(one.from.id),
      );
      const { address: _gone, ...rest } = held[at];
      held[at] = rest as Node;
    }
  };
  const repository = {
    find: (_did: string, ref: OwnedRef) =>
      Promise.resolve(
        there().find((one) => ownedRefFrom(one.id) === ref) ?? null,
      ),
    carried: (_did: string, root: Node) => Promise.resolve(under(root, held)),
    childAddresses: (_did: string, parent: Node | null) =>
      Promise.resolve(
        held
          .filter((one) =>
            parent
              ? one.parent === ownedRefFrom(parent.id)
              : one.parent === undefined,
          )
          .flatMap((one) => (one.address === undefined ? [] : [one.address])),
      ),
    findDeleted: (_did: string, ref: OwnedRef) =>
      Promise.resolve(
        held.find(
          (one) => ownedRefFrom(one.id) === ref && one.deleted_at !== undefined,
        ) ?? null,
      ),
    move: async (
      _did: string,
      landed: Node[],
      aliases: NodeAlias[],
      giving: { from: Node; alias?: NodeAlias }[] = [],
    ) => {
      await landing;
      yieldUp(giving);
      for (const one of landed) {
        if (one.address === undefined) continue;
        if (spent(one.address, ownedRefFrom(one.id))) {
          throw new Error(`${one.address} is already indexed`);
        }
      }
      asked.landed = [...landed];
      asked.aliases = [...aliases];
      for (const one of landed) {
        for (let at = left.length - 1; at >= 0; at--) {
          if (
            left[at].address === one.address &&
            left[at].note === ownedRefFrom(one.id)
          ) {
            left.splice(at, 1);
          }
        }
      }
      for (const one of aliases) leadBack(one);
      for (const one of landed) {
        const at = held.findIndex(
          (was) => ownedRefFrom(was.id) === ownedRefFrom(one.id),
        );
        held[at] = one;
      }
    },
    addressLeadsTo: (_did: string, _graph: OwnedRef, address: Address) => {
      const at = held.find((one) => one.address === address);
      if (at) {
        return Promise.resolve({
          hold: at.deleted_at === undefined ? "live" : "deleted",
          note: ownedRefFrom(at.id),
        });
      }
      if (retired.has(address)) return Promise.resolve({ hold: "deleted" });
      const alias = left.find((one) => one.address === address);
      return Promise.resolve(
        alias ? { hold: "moved", note: alias.note } : null,
      );
    },
    writeAddress: (
      _did: string,
      node: Node,
      address: Address | undefined,
      leaving: NodeAlias | null,
      giving: { from: Node; alias?: NodeAlias }[] = [],
    ) => {
      yieldUp(giving);
      asked.aliases = leaving ? [leaving] : [];
      if (leaving) leadBack(leaving);
      for (let at = left.length - 1; at >= 0; at--) {
        if (
          left[at].address === address &&
          left[at].note === ownedRefFrom(node.id)
        ) {
          left.splice(at, 1);
        }
      }
      const at = held.findIndex(
        (one) => ownedRefFrom(one.id) === ownedRefFrom(node.id),
      );
      const { address: _was, ...rest } = held[at];
      held[at] = { ...rest, ...(address === undefined ? {} : { address }) };
      return Promise.resolve(held[at]);
    },
    insert: (one: Node, giving: { from: Node; alias?: NodeAlias }[] = []) => {
      yieldUp(giving);
      if (one.address !== undefined && spent(one.address)) {
        return Promise.reject(new Error(`${one.address} is already indexed`));
      }
      held.push(one);
      return Promise.resolve(one);
    },
    addressesLedBack: (
      _did: string,
      _graph: OwnedRef,
      addresses: readonly Address[],
    ) =>
      Promise.resolve(
        new Set(
          addresses.filter((address) =>
            left.some((one) => one.address === address),
          ),
        ),
      ),
    addressTaken: (_did: string, _graph: OwnedRef, address: Address) => {
      const at = held.find((one) => one.address === address);
      if (at) {
        return Promise.resolve(
          at.deleted_at === undefined ? "live" : "deleted",
        );
      }
      if (retired.has(address)) return Promise.resolve("deleted");
      return Promise.resolve(
        left.some((one) => one.address === address) ? "moved" : null,
      );
    },
    addressesSpent: (
      _did: string,
      _graph: OwnedRef,
      addresses: readonly Address[],
    ) =>
      Promise.resolve(
        new Set(
          addresses.filter(
            (address) =>
              held.some((one) => one.address === address) ||
              left.some((one) => one.address === address) ||
              retired.has(address),
          ),
        ),
      ),
    subtree: (_did: string, root: Node) =>
      Promise.resolve(under(root, there())),
    aliasesOf: (_did: string, _graph: OwnedRef, notes: readonly OwnedRef[]) => {
      const by = new Map<OwnedRef, Address[]>();
      for (const alias of left) {
        if (!notes.includes(alias.note)) continue;
        by.set(alias.note, [...(by.get(alias.note) ?? []), alias.address]);
      }
      return Promise.resolve(by);
    },
  } as unknown as NodeRepository;
  return {
    asked,
    service: new NodeService(repository, finds, graphs, media, publications),
  };
}

describe("carrying a note somewhere else", () => {
  /** `1a` with `1a1` under it, alongside a branch `2` that already holds two. */
  const tree = () => {
    const root = live("1");
    const moving = live("1a", { origin: root.ref, parent: root.ref });
    const beneath = live("1a1", { origin: root.ref, parent: moving.ref });
    const other = live("2");
    const first = live("2a", { origin: other.ref, parent: other.ref });
    const second = live("2b", { origin: other.ref, parent: other.ref });
    return {
      root,
      moving,
      beneath,
      other,
      first,
      second,
      all: [root, moving, beneath, other, first, second],
    };
  };

  it("keeps every note under it at the same place relative to it", async () => {
    const { moving, beneath, other, all } = tree();
    const { asked, service } = notebook(all);

    const after = await service.move(DID, moving.ref, {
      relation: "under",
      note: other.ref,
    });

    expect(after.map((one) => [one.ref, one.address])).toEqual([
      [moving.ref, "2c"],
      [beneath.ref, "2c1"],
    ]);
    expect(
      asked.landed.map((one) => [one.depth, one.origin, one.parent]),
    ).toEqual([
      [2, other.ref, other.ref],
      [3, other.ref, moving.ref],
    ]);
  });

  it("leaves every address it was at leading to the note that was there", async () => {
    const { root, moving, beneath, other, all } = tree();
    const { asked, service } = notebook(all);

    await service.move(DID, moving.ref, { relation: "under", note: other.ref });

    expect(
      asked.aliases.map((one) => [one.address, one.note, one.parent]),
    ).toEqual([
      ["1a", moving.ref, root.ref],
      ["1a1", beneath.ref, moving.ref],
    ]);
    expect(new Set(asked.aliases.map((one) => one.graph))).toEqual(
      new Set([HOME]),
    );
  });

  it("appends to a run it is already in, renumbering neither sibling", async () => {
    const { other, first, second } = tree();
    const { service } = notebook([other, first, second]);

    const after = await service.move(DID, first.ref, {
      relation: "after",
      note: second.ref,
    });

    expect(after.map((one) => one.address)).toEqual(["2c"]);
  });

  it("carries a deleted note under it, and answers without it", async () => {
    const root = live("1");
    const moving = live("1a", { origin: root.ref, parent: root.ref });
    const away = live("1a1", {
      origin: root.ref,
      parent: moving.ref,
      deleted_at: AT,
    });
    const other = live("2");
    const { asked, service } = notebook([root, moving, away, other]);

    const after = await service.move(DID, moving.ref, {
      relation: "under",
      note: other.ref,
    });

    expect(asked.landed.map((one) => one.address)).toEqual(["2a", "2a1"]);
    expect(asked.aliases.map((one) => one.address)).toEqual(["1a", "1a1"]);
    expect(after.map((one) => one.address)).toEqual(["2a"]);
  });

  it("becomes a branch of its own where it follows one", async () => {
    const root = live("1");
    const moving = live("1a", { origin: root.ref, parent: root.ref });
    const beneath = live("1a1", { origin: root.ref, parent: moving.ref });
    const { asked, service } = notebook([root, moving, beneath]);

    const after = await service.move(DID, moving.ref, {
      relation: "after",
      note: root.ref,
    });

    expect(after.map((one) => one.address)).toEqual(["2", "2a"]);
    expect(asked.landed.map((one) => one.origin)).toEqual([
      moving.ref,
      moving.ref,
    ]);
    expect(asked.landed[0].parent).toBeUndefined();
  });

  it("numbers a note written under it from where it landed, not where it was", async () => {
    const root = live("1");
    const moving = live("1a", { origin: root.ref, parent: root.ref });
    const other = live("2");
    let land = () => {};
    const { service } = notebook(
      [root, moving, other],
      new Promise<void>((resolve) => {
        land = resolve;
      }),
    );

    const carried = service.move(DID, moving.ref, {
      relation: "under",
      note: other.ref,
    });
    const written = service.create(DID, {
      title: "",
      tags: [],
      from: { relation: "under", note: moving.ref },
    });
    land();

    expect((await carried).map((one) => one.address)).toEqual(["2a"]);
    expect((await written).address).toBe("2a1");
  });

  /** The message, once the refusal has been checked to have written nothing. */
  const refused = async (
    notes: readonly (Node & { ref: OwnedRef })[],
    ref: OwnedRef,
    to: NoteDestination,
  ) => {
    const { asked, service } = notebook(notes);
    const move = service.move(DID, ref, to);
    await expect(move).rejects.toBeInstanceOf(BadRequestException);
    expect(asked.landed).toEqual([]);
    return move.catch((err: Error) => err.message);
  };

  it("refuses to carry a note onto itself", async () => {
    const { moving, all } = tree();
    await expect(
      refused(all, moving.ref, { relation: "under", note: moving.ref }),
    ).resolves.toMatch(/different one/);
    await expect(
      refused(all, moving.ref, { relation: "after", note: moving.ref }),
    ).resolves.toMatch(/different one/);
  });

  it("refuses to carry a note into what sprang from it", async () => {
    const { moving, beneath, all } = tree();

    await expect(
      refused(all, moving.ref, { relation: "under", note: beneath.ref }),
    ).resolves.toMatch(/sprang from it/);
    await expect(
      refused(all, moving.ref, { relation: "after", note: beneath.ref }),
    ).resolves.toMatch(/sprang from it/);
  });

  it("refuses a note in another graph, and says a note stays in its own", async () => {
    const root = live("1");
    const moving = live("1a", { origin: root.ref, parent: root.ref });
    const elsewhere = live("1", {
      graph: `${DID}/00000000000000000000000001`,
    });

    await expect(
      refused([root, moving, elsewhere], moving.ref, {
        relation: "under",
        note: elsewhere.ref,
      }),
    ).resolves.toMatch(/another graph/);
  });

  it("refuses a note that is not there to be carried to", async () => {
    const root = live("1");
    const moving = live("1a", { origin: root.ref, parent: root.ref });
    const away = live("2", { deleted_at: AT });

    await expect(
      refused([root, moving, away], moving.ref, {
        relation: "under",
        note: away.ref,
      }),
    ).resolves.toMatch(/springs from is not here/);
    await expect(
      refused([root, moving, away], moving.ref, {
        relation: "after",
        note: away.ref,
      }),
    ).resolves.toMatch(/follows is not here/);
  });

  it("refuses to carry a note that is not there", async () => {
    const root = live("1");
    const away = live("1a", {
      origin: root.ref,
      parent: root.ref,
      deleted_at: AT,
    });
    const { service } = notebook([root, away]);

    await expect(
      service.move(DID, away.ref, { relation: "under", note: root.ref }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("carries a note with no number and leaves it with none", async () => {
    const root = live("1");
    const moving = unnumbered("Scratch", {
      origin: root.ref,
      parent: root.ref,
    });
    const other = live("2");
    const { asked, service } = notebook([root, moving, other]);

    const after = await service.move(DID, moving.ref, {
      relation: "under",
      note: other.ref,
    });

    expect(after.map((one) => one.address)).toEqual([undefined]);
    expect(asked.aliases).toEqual([]);
    expect(asked.landed.map((one) => [one.depth, one.parent])).toEqual([
      [2, other.ref],
    ]);
  });

  it("carries a note under one nobody numbered, and it keeps no number", async () => {
    const root = live("1");
    const moving = live("1a", { origin: root.ref, parent: root.ref });
    const beneath = live("1a1", { origin: root.ref, parent: moving.ref });
    const landing = unnumbered("Scratch");
    const { asked, service } = notebook([root, moving, beneath, landing]);

    const after = await service.move(DID, moving.ref, {
      relation: "under",
      note: landing.ref,
    });

    expect(after.map((one) => [one.title, one.address])).toEqual([
      ["1a", undefined],
      ["1a1", "1a1"],
    ]);
    expect(asked.aliases.map((one) => one.address)).toEqual(["1a"]);
  });

  it("refuses to carry a note into what sprang from it, numbered or not", async () => {
    const moving = unnumbered("Scratch");
    const beneath = unnumbered("Under it", {
      origin: moving.ref,
      parent: moving.ref,
      depth: 2,
    });

    await expect(
      refused([moving, beneath], moving.ref, {
        relation: "under",
        note: beneath.ref,
      }),
    ).resolves.toMatch(/sprang from it/);
  });

  it("refuses a branch of its own when nothing could follow the highest one", async () => {
    const highest = String(Number.MAX_SAFE_INTEGER - 1);
    const root = live(highest);
    const moving = live(`${highest}a`, {
      origin: root.ref,
      parent: root.ref,
    });

    await expect(
      refused([root, moving], moving.ref, {
        relation: "after",
        note: root.ref,
      }),
    ).resolves.toMatch(/under a note instead/);
  });
});

// AI.md § "The Genealogy Is the Protocol": a moved note takes the next address
// in the run it joins unless the person names one.
describe("carrying a note to the number a person named", () => {
  /** `2c`, with `2c1` under it, and a note at `3a` on another branch. */
  const nesting = () => {
    const root = live("2");
    const moving = live("2c", { origin: root.ref, parent: root.ref });
    const beneath = live("2c1", { origin: root.ref, parent: moving.ref });
    const other = live("3");
    const landing = live("3a", { origin: other.ref, parent: other.ref });
    return {
      root,
      moving,
      beneath,
      other,
      landing,
      all: [root, moving, beneath, other, landing],
    };
  };

  const named = async (
    notes: readonly (Node & { ref: OwnedRef })[],
    ref: OwnedRef,
    to: NoteDestination,
    address: Address,
  ) => {
    const { asked, service } = notebook(notes);
    const move = service.move(DID, ref, to, address);
    await expect(move).rejects.toBeInstanceOf(BadRequestException);
    expect(asked.landed).toEqual([]);
    return move.catch((err: Error) => err.message);
  };

  it("takes it, and keeps everything under it where it was relative to it", async () => {
    const { moving, beneath, other, landing, all } = nesting();
    const { asked, service } = notebook(all);

    const after = await service.move(
      DID,
      moving.ref,
      { relation: "under", note: landing.ref },
      "3a1",
    );

    expect(after.map((one) => [one.ref, one.address])).toEqual([
      [moving.ref, "3a1"],
      [beneath.ref, "3a1a"],
    ]);
    expect(
      asked.landed.map((one) => [one.depth, one.origin, one.parent]),
    ).toEqual([
      [3, other.ref, landing.ref],
      [4, other.ref, moving.ref],
    ]);
  });

  it("leaves every address it was at leading to the note that was there", async () => {
    const { root, moving, beneath, landing, all } = nesting();
    const { asked, service } = notebook(all);

    await service.move(
      DID,
      moving.ref,
      { relation: "under", note: landing.ref },
      "3a1",
    );

    expect(
      asked.aliases.map((one) => [one.address, one.note, one.parent]),
    ).toEqual([
      ["2c", moving.ref, root.ref],
      ["2c1", beneath.ref, moving.ref],
    ]);
  });

  it("numbers a note that carried none, and leaves what is under it unnumbered", async () => {
    const other = live("3");
    const landing = live("3a", { origin: other.ref, parent: other.ref });
    const moving = unnumbered("Pores");
    const beneath = unnumbered("Membranes", { parent: moving.ref });
    const { asked, service } = notebook([
      other,
      landing,
      moving,
      { ...beneath, origin: moving.ref },
    ]);

    const after = await service.move(
      DID,
      moving.ref,
      { relation: "under", note: landing.ref },
      "3a1",
    );

    expect(after.map((one) => one.address)).toEqual(["3a1", undefined]);
    expect(asked.aliases).toEqual([]);
  });

  it("takes a whole number as it becomes a branch of its own", async () => {
    const { moving, beneath, other, all } = nesting();
    const { service } = notebook(all);

    const after = await service.move(
      DID,
      moving.ref,
      { relation: "after", note: other.ref },
      "9",
    );

    expect(after.map((one) => [one.ref, one.address])).toEqual([
      [moving.ref, "9"],
      [beneath.ref, "9a"],
    ]);
  });

  it("hands a note back a number it left behind, on the way home", async () => {
    const { root, moving, landing, all } = nesting();
    const { service } = notebook(all);

    await service.move(
      DID,
      moving.ref,
      { relation: "under", note: landing.ref },
      "3a1",
    );
    const home = await service.move(
      DID,
      moving.ref,
      { relation: "under", note: root.ref },
      "2c",
    );

    expect(home.map((one) => one.address)).toEqual(["2c", "2c1"]);
    // The numbers it is at again lead to it by the rows, not by an alias
    // beside them.
    expect(home.map((one) => one.aliases)).toEqual([["3a1"], ["3a1a"]]);
  });

  it("refuses one a note it carries was carried away from", async () => {
    const { moving, beneath, landing, all } = nesting();
    const { service } = notebook(all);

    await service.setAddress(DID, beneath.ref, "3a1");
    await service.setAddress(DID, beneath.ref, "2c1");
    const onto = service.move(
      DID,
      moving.ref,
      { relation: "under", note: landing.ref },
      "3a1",
    );

    await expect(onto).rejects.toBeInstanceOf(BadRequestException);
    await expect(onto).rejects.toThrow(/3a1 still leads to/);
  });

  it("refuses one that springs from somewhere else", async () => {
    const { moving, landing, all } = nesting();

    await expect(
      named(all, moving.ref, { relation: "under", note: landing.ref }, "3b1"),
    ).resolves.toMatch(/3b1 does not spring from 3a/);
  });

  it("refuses a whole number under a note", async () => {
    const { moving, landing, all } = nesting();

    await expect(
      named(all, moving.ref, { relation: "under", note: landing.ref }, "4"),
    ).resolves.toMatch(/does not spring from 3a/);
  });

  it("refuses one that springs from a note as it becomes a branch", async () => {
    const { moving, other, all } = nesting();

    await expect(
      named(all, moving.ref, { relation: "after", note: other.ref }, "3a1"),
    ).resolves.toMatch(/whole number/);
  });

  it("refuses any number under a note nobody numbered", async () => {
    const other = live("3");
    const landing = unnumbered("Method", {
      origin: other.ref,
      parent: other.ref,
    });
    const moving = live("2");

    await expect(
      named(
        [other, landing, moving],
        moving.ref,
        { relation: "under", note: landing.ref },
        "3a1",
      ),
    ).resolves.toMatch(/has no number/);
  });

  it("refuses one another note is at, and names that note", async () => {
    const { moving, landing, all } = nesting();
    const taken = live("3a1", {
      title: "Osmosis",
      origin: landing.ref,
      parent: landing.ref,
    });

    await expect(
      named(
        [...all, taken],
        moving.ref,
        { relation: "under", note: landing.ref },
        "3a1",
      ),
    ).resolves.toMatch(/3a1 already leads to “Osmosis”/);
  });

  it("refuses one that still leads to a note carried away from it", async () => {
    const { moving, other, landing, all } = nesting();
    const away = live("3a1", { origin: other.ref, parent: landing.ref });
    const { service } = notebook([...all, away]);

    await service.move(
      DID,
      away.ref,
      { relation: "after", note: other.ref },
      "8",
    );
    const onto = service.move(
      DID,
      moving.ref,
      { relation: "under", note: landing.ref },
      "3a1",
    );

    await expect(onto).rejects.toBeInstanceOf(BadRequestException);
    await expect(onto).rejects.toThrow(/3a1 still leads to/);
  });
});

describe("the label a person writes on a note", () => {
  it("writes one on a note that carried none", async () => {
    const note = unnumbered("Mushrooms");
    const { asked, service } = notebook([note]);

    const written = await service.setAddress(DID, note.ref, "1a");

    expect(written.address).toBe("1a");
    expect(written.depth).toBe(1);
    expect(asked.aliases).toEqual([]);
  });

  it("takes one off, and the address it left still leads to it", async () => {
    const note = live("1a");
    const { asked, service } = notebook([note]);

    const written = await service.setAddress(DID, note.ref, null);

    expect(written.address).toBeUndefined();
    expect(written.aliases).toEqual(["1a"]);
    expect(asked.aliases.map((one) => [one.address, one.note])).toEqual([
      ["1a", note.ref],
    ]);
  });

  it("leaves the depth where the genealogy puts it", async () => {
    const root = live("1");
    const under = live("1a", { origin: root.ref, parent: root.ref });
    const { service } = notebook([root, under]);

    expect((await service.setAddress(DID, under.ref, null)).depth).toBe(2);
    expect((await service.setAddress(DID, under.ref, "7b")).depth).toBe(2);
  });

  it("refuses one another note is at, and names that note", async () => {
    const held = live("2c", { title: "Mycelium" });
    const note = unnumbered("Mushrooms");
    const { service } = notebook([held, note]);

    const written = service.setAddress(DID, note.ref, "2c");

    await expect(written).rejects.toBeInstanceOf(BadRequestException);
    await expect(written).rejects.toThrow(
      /2c already leads to “Mycelium”\. Pick another number\./,
    );
  });

  it("refuses one that still leads to a note carried away from it", async () => {
    const root = live("1");
    const moving = live("1a", { origin: root.ref, parent: root.ref });
    const other = live("2");
    const note = unnumbered("Mushrooms");
    const { service } = notebook([root, moving, other, note]);
    await service.move(DID, moving.ref, { relation: "under", note: other.ref });

    await expect(service.setAddress(DID, note.ref, "1a")).rejects.toThrow(
      /1a still leads to “1a”/,
    );
  });

  it("hands a note back an address it carried before", async () => {
    const root = live("1");
    const moving = live("1a", { origin: root.ref, parent: root.ref });
    const other = live("2");
    const { service } = notebook([root, moving, other]);
    await service.move(DID, moving.ref, { relation: "under", note: other.ref });

    const written = await service.setAddress(DID, moving.ref, "1a");

    expect(written.address).toBe("1a");
    expect(written.aliases ?? []).toEqual(["2a"]);
  });

  it("refuses a note that is not here", async () => {
    const note = live("1", { deleted_at: AT });
    const { service } = notebook([note]);

    await expect(service.setAddress(DID, note.ref, "2")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

/** An address one note was carried away from, as the store holds it. */
function carriedAwayFrom(address: string, note: OwnedRef): NodeAlias {
  return {
    id: createOwnedRecordId("node_alias", DID),
    created_by: DID,
    graph: HOME,
    address,
    note,
    created_at: AT,
    updated_at: AT,
  } as NodeAlias;
}

// AI.md § "The Genealogy Is the Protocol": a note in the bin holds its address
// only until a person asks for it.
describe("a number a note in the bin is holding", () => {
  it("goes to the note a person writes it on, and stays leading to the one in the bin", async () => {
    const binned = live("2b", { title: "Spores", deleted_at: AT });
    const note = unnumbered("Mushrooms");
    const { asked, service } = notebook([binned, note]);

    const written = await service.setAddress(DID, note.ref, "2b");

    expect(written.address).toBe("2b");
    expect(asked.yielded).toEqual([{ from: binned.ref, alias: "2b" }]);
  });

  it("goes to a note written at it", async () => {
    const root = live("2");
    const binned = live("2c", {
      origin: root.ref,
      parent: root.ref,
      deleted_at: AT,
    });
    const { asked, service } = notebook([root, binned]);

    const written = await service.create(DID, {
      from: { relation: "under", note: root.ref },
      address: "2c",
      title: "Osmosis",
      tags: [],
    });

    expect(written.address).toBe("2c");
    expect(asked.yielded).toEqual([{ from: binned.ref, alias: "2c" }]);
  });

  it("goes to a branch written at it", async () => {
    const binned = live("9", { deleted_at: AT });
    const { asked, service } = notebook([binned]);

    const written = await service.create(DID, {
      from: { relation: "root", address: "9" },
      title: "Lichen",
      tags: [],
    });

    expect(written.address).toBe("9");
    expect(asked.yielded).toEqual([{ from: binned.ref, alias: "9" }]);
  });

  it("goes to a note carried onto it", async () => {
    const root = live("2");
    const binned = live("2a", {
      origin: root.ref,
      parent: root.ref,
      deleted_at: AT,
    });
    const other = live("3");
    const moving = live("3a", { origin: other.ref, parent: other.ref });
    const { asked, service } = notebook([root, binned, other, moving]);

    const carried = await service.move(
      DID,
      moving.ref,
      { relation: "under", note: root.ref },
      "2a",
    );

    expect(carried[0].address).toBe("2a");
    expect(asked.yielded).toEqual([{ from: binned.ref, alias: "2a" }]);
  });

  it("is given up once: a second asking leaves the alias where it is", async () => {
    const first = live("1a", { deleted_at: AT });
    const second = live("2b", { deleted_at: AT });
    const note = unnumbered("Mushrooms");
    const { asked, service } = notebook(
      [first, second, note],
      Promise.resolve(),
      { aliases: [carriedAwayFrom("2b", first.ref)] },
    );

    const written = await service.setAddress(DID, note.ref, "2b");

    expect(written.address).toBe("2b");
    expect(asked.yielded).toEqual([{ from: second.ref }]);
  });

  it("goes on leading to the note in the bin when the one that took it lets it go", async () => {
    const binned = live("2b", { title: "Spores", deleted_at: AT });
    const note = unnumbered("Mushrooms");
    const { asked, service } = notebook([binned, note]);
    await service.setAddress(DID, note.ref, "2b");

    const off = await service.setAddress(DID, note.ref, null);

    expect(off.address).toBeUndefined();
    expect(asked.aliases).toEqual([]);
  });

  it("goes on leading to it when the note that took it is carried elsewhere", async () => {
    const root = live("1");
    const binned = live("1a", {
      origin: root.ref,
      parent: root.ref,
      deleted_at: AT,
    });
    const other = live("2");
    const note = unnumbered("Mushrooms", {
      origin: other.ref,
      parent: other.ref,
    });
    const { asked, service } = notebook([root, binned, other, note]);
    await service.setAddress(DID, note.ref, "1a");

    const carried = await service.move(DID, note.ref, {
      relation: "under",
      note: root.ref,
    });

    expect(carried[0].address).toBe("1b");
    expect(asked.aliases).toEqual([]);
  });

  it("is free to write where the note in the bin gave it up already", async () => {
    const binned = live("1a", { deleted_at: AT });
    const note = unnumbered("Mushrooms");
    const { asked, service } = notebook([binned, note], Promise.resolve(), {
      aliases: [carriedAwayFrom("2b", binned.ref)],
    });

    const written = await service.setAddress(DID, note.ref, "2b");

    expect(written.address).toBe("2b");
    expect(asked.yielded).toEqual([]);
  });

  it("is refused where the note holding it is there", async () => {
    const there = live("2c", { title: "Mycelium" });
    const note = unnumbered("Mushrooms");
    const { service } = notebook([there, note]);

    await expect(service.setAddress(DID, note.ref, "2c")).rejects.toThrow(
      /2c already leads to “Mycelium”\. Pick another number\./,
    );
  });

  it("is refused where a note that is there was carried away from it", async () => {
    const root = live("1");
    const moving = live("1a", {
      title: "Hyphae",
      origin: root.ref,
      parent: root.ref,
    });
    const other = live("2");
    const note = unnumbered("Mushrooms");
    const { service } = notebook([root, moving, other, note]);
    await service.move(DID, moving.ref, { relation: "under", note: other.ref });

    await expect(service.setAddress(DID, note.ref, "1a")).rejects.toThrow(
      /1a still leads to “Hyphae”/,
    );
  });

  it("is refused where the note that spent it has been purged", async () => {
    const note = unnumbered("Mushrooms");
    const { service } = notebook([note], Promise.resolve(), {
      retired: ["2b" as Address],
    });

    await expect(service.setAddress(DID, note.ref, "2b")).rejects.toThrow(
      /You have used 2b before\. Pick another number\./,
    );
  });
});

describe("the number a person names for a note they are writing", () => {
  /** `2`, with `2c` under it, and `3` beside them. */
  const beside = () => {
    const root = live("2");
    const under = live("2c", { origin: root.ref, parent: root.ref });
    const other = live("3");
    return { root, under, other, all: [root, under, other] };
  };

  const refused = async (
    service: NodeService,
    request: Parameters<NodeService["create"]>[1],
  ) => {
    const written = service.create(DID, request);
    await expect(written).rejects.toBeInstanceOf(BadRequestException);
    return written.catch((err: Error) => err.message);
  };

  it("is what the note takes, rather than the one the rule would offer", async () => {
    const { root, all } = beside();
    const { service } = notebook(all);

    const written = await service.create(DID, {
      from: { relation: "under", note: root.ref },
      address: "2z",
      title: "Osmosis",
      tags: [],
    });

    expect([written.address, written.depth, written.parent]).toEqual([
      "2z",
      2,
      root.ref,
    ]);
  });

  it("opens a branch at a whole number nobody is at", async () => {
    const { all } = beside();
    const { service } = notebook(all);

    const written = await service.create(DID, {
      from: { relation: "branch" },
      address: "9",
      title: "",
      tags: [],
    });

    expect([written.address, written.depth, written.parent]).toEqual([
      "9",
      1,
      undefined,
    ]);
  });

  it("is refused where another note is already at it", async () => {
    const { root, all } = beside();
    const { service } = notebook(all);

    expect(
      await refused(service, {
        from: { relation: "under", note: root.ref },
        address: "2c",
        title: "",
        tags: [],
      }),
    ).toMatch(/2c already leads to “2c”\. Pick another number\./);
  });

  it("is refused where it still leads to a note carried away from it", async () => {
    const { root, under, other, all } = beside();
    const { service } = notebook(all);
    await service.move(DID, under.ref, { relation: "under", note: other.ref });

    expect(
      await refused(service, {
        from: { relation: "under", note: root.ref },
        address: "2c",
        title: "",
        tags: [],
      }),
    ).toMatch(/2c still leads to “2c”/);
  });

  it("is refused where it does not spring from the note it is written under", async () => {
    const { other, all } = beside();
    const { service } = notebook(all);

    expect(
      await refused(service, {
        from: { relation: "under", note: other.ref },
        address: "2d",
        title: "",
        tags: [],
      }),
    ).toMatch(/2d does not spring from 3\. Number it under 3 instead\./);
  });

  it("is refused where it springs from a note and this one springs from nothing", async () => {
    const { all } = beside();
    const { service } = notebook(all);

    expect(
      await refused(service, {
        from: { relation: "branch" },
        address: "9a",
        title: "",
        tags: [],
      }),
    ).toMatch(/9a springs from another note/);
  });

  it("is refused under a note whose author numbered none", async () => {
    const above = unnumbered("Mushrooms");
    const { service } = notebook([above]);

    expect(
      await refused(service, {
        from: { relation: "under", note: above.ref },
        address: "3a",
        title: "",
        tags: [],
      }),
    ).toMatch(/“Mushrooms” has no number/);
  });

  it("is refused beside a placement that names a branch's number too", async () => {
    const { service } = notebook([]);

    expect(
      await refused(service, {
        from: { relation: "root", address: "9" },
        address: "9",
        title: "",
        tags: [],
      }),
    ).toMatch(/Sloppy is out of date/);
  });
});

// A label sits wherever its author wrote it, so the run the store reads by
// parent is not the whole of what a number could be on. These are the sequences
// where the rule offers a number somebody has already written somewhere else.
describe("a label written outside the run it names", () => {
  /** A branch at `1`, and beside it the notes whose authors labelled them. */
  const beside = (...labels: string[]) => {
    const root = live("1");
    return {
      root,
      ...notebook([root, ...labels.map((address) => live(address))]),
    };
  };

  const springing = (root: Node & { ref: OwnedRef }) => ({
    title: "",
    tags: [],
    from: { relation: "under" as const, note: root.ref },
  });

  it("is passed over by the next note written into that run", async () => {
    const { root, service } = beside("1a");

    expect((await service.create(DID, springing(root))).address).toBe("1b");
  });

  it("is passed over however many of them are in the way", async () => {
    const { root, service } = beside("1a", "1b", "1c");

    expect((await service.create(DID, springing(root))).address).toBe("1d");
  });

  it("still numbers the run it was written in from its own end", async () => {
    const { root, service } = beside("1a");
    const first = await service.create(DID, springing(root));

    expect(first.address).toBe("1b");
    expect((await service.create(DID, springing(root))).address).toBe("1c");
  });

  it("moves a subtree along rather than landing it on one", async () => {
    const root = live("1");
    const child = live("1a", { origin: root.ref, parent: root.ref });
    const other = live("2");
    const { service } = notebook([root, child, other, live("2a1")]);

    const carried = await service.move(DID, root.ref, {
      relation: "under",
      note: other.ref,
    });

    expect(carried.map((one) => [one.ref, one.address])).toEqual([
      [root.ref, "2b"],
      [child.ref, "2b1"],
    ]);
  });

  it("is passed over once its author has taken it off and it still leads back", async () => {
    const root = live("1");
    const aside = unnumbered("Numbered by hand");
    const { service } = notebook([root, aside]);
    await service.setAddress(DID, aside.ref, "1a");
    await service.setAddress(DID, aside.ref, null);

    expect((await service.create(DID, springing(root))).address).toBe("1b");
  });

  it("moves a subtree along once it has been taken off too", async () => {
    const root = live("1");
    const child = live("1a", { origin: root.ref, parent: root.ref });
    const other = live("2");
    const aside = unnumbered("Numbered by hand");
    const { service } = notebook([root, child, other, aside]);
    await service.setAddress(DID, aside.ref, "2a");
    await service.setAddress(DID, aside.ref, null);

    const carried = await service.move(DID, root.ref, {
      relation: "under",
      note: other.ref,
    });

    expect(carried.map((one) => [one.ref, one.address])).toEqual([
      [root.ref, "2b"],
      [child.ref, "2b1"],
    ]);
  });

  it("is refused in words once every number the rule reaches is one", async () => {
    const wall: string[] = [];
    for (let address = "1a" as Address; wall.length < 40; ) {
      wall.push(address);
      address = siblingAddress(address);
    }
    const { root, service } = beside(...wall);

    const written = service.create(DID, springing(root));

    await expect(written).rejects.toBeInstanceOf(BadRequestException);
    await expect(written).rejects.toThrow(/1a through .+ all lead somewhere/);
  });
});

describe("an address typed into a search", () => {
  /** A graph where `1c` is where `1a` was carried to, and `1a` is the address
   *  it left behind. */
  function searching(): {
    asked: { address?: string };
    service: NodeService;
    note: Node & { ref: OwnedRef };
  } {
    const note = live("1c");
    const asked: { address?: string } = {};
    const finding = {
      notesAddressed: (_did: string, address: string) => {
        asked.address = address;
        return Promise.resolve({
          at: address === "1c" ? [note.ref] : [],
          carriedAway: address === "1a" ? [note.ref] : [],
        });
      },
      writingMatches: () => Promise.resolve([]),
      heldWritingMatches: () => Promise.resolve([]),
    } as unknown as FindRepository;
    const repository = {
      many: () => Promise.resolve([note as Node]),
      notesIn: () => Promise.resolve([]),
    } as unknown as NodeRepository;
    return {
      asked,
      service: new NodeService(
        repository,
        finding,
        graphs,
        media,
        publications,
      ),
      note,
    };
  }

  it("reaches the note at it", async () => {
    const { service, note } = searching();

    expect(await service.search(DID, "1c")).toEqual([
      {
        note: note.ref,
        address: "1c",
        graph: homeGraphRef(DID),
        title: "1c",
        snippet: "",
        created_at: AT,
        held: false,
      },
    ]);
  });

  it("reaches the note it has been carried away from, saying so", async () => {
    const { service, note } = searching();

    expect(await service.search(DID, "1a")).toEqual([
      {
        note: note.ref,
        address: "1c",
        graph: homeGraphRef(DID),
        title: "1c",
        snippet: "",
        created_at: AT,
        wasAt: "1a",
        held: false,
      },
    ]);
  });

  it("asks for no address where the words are not one", async () => {
    const { asked, service } = searching();

    expect(await service.search(DID, "spores")).toEqual([]);
    expect(asked.address).toBeUndefined();
  });
});

describe("a graph holding a note nobody numbered", () => {
  it("still opens the next branch after its highest one", async () => {
    const { service } = notebook([unnumbered("On its own"), live("1")]);

    const written = await service.create(DID, { title: "", tags: [] });

    expect(written.address).toBe("2");
  });

  it("writes a note under it with no number either", async () => {
    const alone = unnumbered("On its own");
    const { service } = notebook([alone]);

    const written = await service.create(DID, {
      from: { relation: "under", note: alone.ref },
      title: "What it led to",
      tags: [],
    });

    expect(written.address).toBeUndefined();
    expect(written.parent).toBe(alone.ref);
    expect(written.depth).toBe(alone.depth + 1);
  });
});
