// The arithmetic one act does before it reaches the store. What it does TO the
// store — that a stranger's note is out of reach, that a delete takes the
// blocks with it — is a claim about a running system and lives in
// `domain.integration.test.ts`.

import { BadRequestException, NotFoundException } from "@nestjs/common";
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
import type { NodeBulkPatch, NodeRepository } from "./node.repository";
import { NodeService } from "./node.service";

const DID = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva";

/** Nothing here names a picture, so no store is ever asked for one. */
const media = {} as MediaService;

function note(address: string, tags: string[] = []): Node {
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
    published: false,
    created_at: now,
    updated_at: now,
  } as Node;
}

/** The writes an act asked for, alongside the service that made them. */
function serviceOver(notes: Node[]) {
  const writes: NodeBulkPatch[] = [];
  const removed: Node[] = [];
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
  return { service: new NodeService(repository, media), writes, removed };
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
        act: { act: "publish" },
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
      { notes: [gone], act: { act: "publish" } },
      undefined,
    );

    await expect(asked).rejects.toBeInstanceOf(NotFoundException);
    await expect(asked).rejects.toThrow(/Reload your graph/);
  });

  it("sets and clears the published mark through one act, keyed by which", async () => {
    const notes = [note("1")];
    for (const [asked, written] of [
      ["publish", true],
      ["unpublish", false],
    ] as const) {
      const { service, writes } = serviceOver(notes);
      await service.bulk(DID, over(notes, { act: asked }), undefined);
      expect(writes).toEqual([{ published: written }]);
    }
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
