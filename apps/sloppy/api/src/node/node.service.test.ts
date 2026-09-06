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
  type Node,
  ownedRefFrom,
} from "@sloppy/types";
import { describe, expect, it } from "vitest";
import type { MediaService } from "../media/media.service";
import type { PublicationService } from "../publication/publication.service";
import type { GraphService } from "./graph.service";
import type { NodeRepository } from "./node.repository";
import { NodeService } from "./node.service";

/** Nothing here reaches a picture, so the store is never asked for one. */
const media = {} as MediaService;
/** Nor publishes anything, nor names a graph: a branch with none named opens in
 *  the home graph, which nothing has to look up. */
const publications = {} as PublicationService;
const graphs = {} as GraphService;

describe("a branch the server numbers", () => {
  it("is refused in words when nothing could follow the highest one", async () => {
    const highest = String(Number.MAX_SAFE_INTEGER - 1) as Address;
    const repository = {
      childAddresses: () => Promise.resolve([highest]),
    } as unknown as NodeRepository;

    const written = new NodeService(
      repository,
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
  return new NodeService(repository, graphs, media, publications).deleted(DID);
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
