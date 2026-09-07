// The one refusal the number line itself forces, and which of the notes
// somebody deleted a listing offers back. Everything else about writing a note
// is exercised against a running server in `domain.integration.test.ts`; the
// refusal cannot live there, because reaching the top means owning a branch
// numbered near it and every automatic branch that graph opened afterwards
// would follow that number rather than its own.

import { BadRequestException } from "@nestjs/common";
import {
  type Address,
  createOwnedRecordId,
  DELETED_KEPT_FOR_DAYS,
  type Node,
  ownedRefFrom,
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
