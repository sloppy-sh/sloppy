// The arithmetic one act does before it reaches the store. What it does TO the
// store — that a stranger's note is out of reach, that a delete takes the
// blocks with it — is a claim about a running system and lives in
// `domain.integration.test.ts`.

import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  createOwnedRecordId,
  MAX_TAGS_PER_NODE,
  type Node,
  type NodeBulkRequestSchema,
  nowIso,
  type OwnedRef,
  ownedRefFrom,
} from "@sloppy/types";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { MediaService } from "../media/media.service";
import type { PublicationService } from "../publication/publication.service";
import type { Delegation } from "../syr/syr.service";
import type { NodeBulkPatch, NodeRepository } from "./node.repository";
import { NodeService } from "./node.service";

const DID = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva";

/** Nothing here names a picture, so no store is ever asked for one. */
const media = {} as MediaService;

const ada: Delegation = {
  did: DID,
  syr_instance_url: "https://syr.test",
  delegate_public_key: "z6MkDelegate",
  access_token: "token",
};

function note(address: string, tags: string[] = [], published = false): Node {
  const id = createOwnedRecordId("node", DID);
  const now = nowIso();
  return {
    id,
    created_by: DID,
    address,
    depth: address.length,
    origin: ownedRefFrom(id),
    title: "",
    tags,
    links: [],
    published,
    created_at: now,
    updated_at: now,
  } as Node;
}

/** One tree, rooted at the first address: what descends from what is read off
 *  the addresses, and only within an origin. */
function tree(...addresses: string[]): Node[] {
  const notes = addresses.map((address) => note(address));
  const origin = ownedRefFrom(notes[0].id);
  return notes.map((one) => ({ ...one, origin }));
}

/**
 * The writes an act asked for, alongside the service that made them. `refuses`
 * names the roots the publish half turns down, which is what a set publishing
 * partway looks like from here.
 */
function serviceOver(notes: Node[], refuses: readonly OwnedRef[] = []) {
  const writes: NodeBulkPatch[] = [];
  const removed: Node[] = [];
  const published: OwnedRef[] = [];
  const repository = {
    many: (_did: string, refs: readonly OwnedRef[]) =>
      Promise.resolve(notes.filter((n) => refs.includes(ownedRefFrom(n.id)))),
    patchAll: (_did: string, changes: ReadonlyMap<OwnedRef, NodeBulkPatch>) => {
      writes.push(...changes.values());
      return Promise.resolve(notes);
    },
    subtree: (_did: string, root: Node) =>
      Promise.resolve([root, ...notes.filter((n) => n !== root)]),
    remove: (_did: string, going: readonly Node[]) => {
      removed.push(...going);
      return Promise.resolve();
    },
  } as unknown as NodeRepository;
  const publications = {
    publish: (_delegation: Delegation, request: { root: OwnedRef }) => {
      if (refuses.includes(request.root)) {
        return Promise.reject(
          new BadRequestException("A picture in 1 is not in your library."),
        );
      }
      published.push(request.root);
      return Promise.resolve({});
    },
  } as unknown as PublicationService;
  return {
    service: new NodeService(repository, media, publications),
    writes,
    removed,
    published,
  };
}

const over = (
  notes: Node[],
  act: z.output<typeof NodeBulkRequestSchema>["act"],
) => ({ notes: notes.map((n) => ownedRefFrom(n.id)), act });

describe("one act over the notes somebody chose", () => {
  it("adds tags to what each note already carries, rather than replacing them", async () => {
    const notes = [note("1", ["biology"]), note("2", ["seed"])];
    const { service, writes } = serviceOver(notes);

    await service.bulk(
      DID,
      over(notes, { act: "tag", tags: ["question"] }),
      undefined,
    );

    expect(writes.map((w) => w.tags)).toEqual([
      ["biology", "question"],
      ["question", "seed"],
    ]);
  });

  it("leaves alone a note that never carried the tag being taken off", async () => {
    const notes = [note("1", ["biology"]), note("2", ["seed"])];
    const { service, writes } = serviceOver(notes);

    await service.bulk(
      DID,
      over(notes, { act: "untag", tags: ["biology"] }),
      undefined,
    );

    expect(writes.map((w) => w.tags)).toEqual([[], ["seed"]]);
  });

  it("is refused in words rather than writing a note nobody could read back", async () => {
    const full = Array.from({ length: MAX_TAGS_PER_NODE }, (_, i) => `tag${i}`);
    const notes = [note("1", full)];
    const { service, writes } = serviceOver(notes);

    const asked = service.bulk(
      DID,
      over(notes, { act: "tag", tags: ["one too many"] }),
      undefined,
    );

    await expect(asked).rejects.toBeInstanceOf(BadRequestException);
    await expect(asked).rejects.toThrow(/\b1\b would go past that/);
    expect(writes).toEqual([]);
  });

  it("counts what it could not reach instead of refusing the rest", async () => {
    const notes = [note("1"), note("2")];
    const { service } = serviceOver(notes);
    const gone = ownedRefFrom(createOwnedRecordId("node", DID));

    const result = await service.bulk(
      DID,
      {
        notes: [...notes.map((n) => ownedRefFrom(n.id)), gone],
        act: { act: "untag", tags: ["nothing"] },
      },
      undefined,
    );

    expect(result.reached).toBe(2);
    expect(result.missed).toBe(1);
    expect(result.notes).toHaveLength(2);
  });

  it("is refused when it reaches nothing at all", async () => {
    const { service } = serviceOver([]);
    const gone = ownedRefFrom(createOwnedRecordId("node", DID));

    const asked = service.bulk(
      DID,
      { notes: [gone], act: { act: "untag", tags: ["nothing"] } },
      undefined,
    );

    await expect(asked).rejects.toBeInstanceOf(NotFoundException);
    await expect(asked).rejects.toThrow(/Reload your graph/);
  });

  it("stores a look with every channel taken back off as no look at all", async () => {
    const notes = [note("1")];
    const { service, writes } = serviceOver(notes);

    await service.bulk(
      DID,
      over(notes, { act: "set_appearance", appearance: {} }),
      undefined,
    );

    expect(writes).toEqual([{ appearance: null }]);
  });

  it("takes each chosen note with everything that sprang from it, once", async () => {
    const notes = [note("1"), note("1a")];
    const { service, removed } = serviceOver(notes);

    const result = await service.bulk(
      DID,
      over(notes, { act: "delete" }),
      undefined,
    );

    expect(removed).toHaveLength(2);
    expect(result).toEqual({ reached: 2, missed: 0, notes: [] });
  });
});

describe("publishing the notes somebody chose", () => {
  it("puts each chosen note out as a branch of its own", async () => {
    const notes = [note("1"), note("2")];
    const { service, published } = serviceOver(notes);

    const result = await service.bulk(
      DID,
      over(notes, { act: "publish" }),
      ada,
    );

    expect(published).toEqual(notes.map((n) => ownedRefFrom(n.id)));
    expect(result.reached).toBe(2);
    expect(result.missed).toBe(0);
  });

  // Publishing both roots would put one piece of writing out twice, in two
  // snapshots each on their own terms.
  it("puts a note the set already carries out inside the one that carries it", async () => {
    const notes = tree("1", "1a", "1a1");
    const { service, published } = serviceOver(notes);

    const result = await service.bulk(
      DID,
      over(notes, { act: "publish" }),
      ada,
    );

    expect(published).toEqual([ownedRefFrom(notes[0].id)]);
    expect(result.reached).toBe(3);
  });

  // Two branches of one tree are two publications; only descent carries.
  it("puts a branch beside another out on its own", async () => {
    const notes = tree("1", "1a", "1b").slice(1);
    const { service, published } = serviceOver(notes);

    await service.bulk(DID, over(notes, { act: "publish" }), ada);

    expect(published).toHaveLength(2);
  });

  it("sends a note that is already published again", async () => {
    const notes = [note("1", [], true)];
    const { service, published } = serviceOver(notes);

    await service.bulk(DID, over(notes, { act: "publish" }), ada);

    expect(published).toEqual([ownedRefFrom(notes[0].id)]);
  });

  it("counts the ones that did not go out and leaves the rest published", async () => {
    const notes = [note("1"), note("2")];
    const { service, published } = serviceOver(notes, [
      ownedRefFrom(notes[0].id),
    ]);

    const result = await service.bulk(
      DID,
      over(notes, { act: "publish" }),
      ada,
    );

    expect(published).toEqual([ownedRefFrom(notes[1].id)]);
    expect(result.reached).toBe(1);
    expect(result.missed).toBe(1);
  });

  // A note under a root that never went out did not go out either, however
  // much of the rest of the set landed.
  it("counts a note whose carrier was turned down", async () => {
    const notes = [...tree("1", "1a"), ...tree("2")];
    const { service, published } = serviceOver(notes, [
      ownedRefFrom(notes[0].id),
    ]);

    const result = await service.bulk(
      DID,
      over(notes, { act: "publish" }),
      ada,
    );

    expect(published).toEqual([ownedRefFrom(notes[2].id)]);
    expect(result.reached).toBe(1);
    expect(result.missed).toBe(2);
  });

  it("is refused in the words it was refused in where nothing went out", async () => {
    const notes = [note("1"), note("2")];
    const { service } = serviceOver(
      notes,
      notes.map((n) => ownedRefFrom(n.id)),
    );

    const asked = service.bulk(DID, over(notes, { act: "publish" }), ada);

    await expect(asked).rejects.toBeInstanceOf(BadRequestException);
    await expect(asked).rejects.toThrow(/not in your library/);
  });

  it("is refused where nothing signed in is asking", async () => {
    const notes = [note("1")];
    const { service, published } = serviceOver(notes);

    const asked = service.bulk(DID, over(notes, { act: "publish" }), undefined);

    await expect(asked).rejects.toBeInstanceOf(UnauthorizedException);
    expect(published).toEqual([]);
  });
});
