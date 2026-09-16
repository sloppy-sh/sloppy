// What taking an offer in decides before it writes — docs/ARCHITECTURE.md
// § "Whose writing a note carries". What it does TO the store is a claim about
// a running system and lives in `amendment.integration.test.ts`.

import {
  type Amendment,
  type Block,
  type BlockDocument,
  createOwnedRecordId,
  type Node,
  type OwnedRef,
  ownedRefFrom,
} from "@sloppy/types";
import { describe, expect, it } from "vitest";
import type { BlockRepository } from "../block/block.repository";
import type { NodeRepository } from "../node/node.repository";
import type { Approval } from "./amendment.repository";
import type { AmendmentRepository } from "./amendment.repository";
import { AmendmentService } from "./amendment.service";

const DID = "did:syr:z6MkAda";
const OTHER = "did:syr:z6MkBram";
const AT = "2026-01-01T00:00:00.000Z";
const WORDS: BlockDocument = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }],
};

const note: Node = {
  id: createOwnedRecordId("node", DID),
  created_by: DID,
  depth: 1,
  origin: ownedRefFrom(createOwnedRecordId("node", DID)),
  title: "A note",
  tags: [],
  links: [],
  published: false,
  created_at: AT,
  updated_at: AT,
} as Node;
const noteRef = ownedRefFrom(note.id);

const section = ownedRefFrom(createOwnedRecordId("block", DID));

function offer(): Amendment {
  return {
    id: createOwnedRecordId("amendment", DID),
    created_by: DID,
    note: noteRef,
    by: OTHER,
    at: AT,
    title: "As they would have it",
    tags: [],
    blocks: [{ ref: section, content: WORDS }],
    created_at: AT,
    updated_at: AT,
  };
}

/** The service over an offer standing on one note, with `elsewhere` naming the
 *  sections that are rows somewhere other than that note's own stack. */
function approving(elsewhere: readonly OwnedRef[] = []) {
  const standing: Block[] = [];
  const taken: Approval[] = [];
  const one = offer();
  const service = new AmendmentService(
    {
      find: () => Promise.resolve(one),
      approve: (_did: string, taking: Approval) => {
        taken.push(taking);
        return Promise.resolve();
      },
    } as unknown as AmendmentRepository,
    { find: () => Promise.resolve(note) } as unknown as NodeRepository,
    {
      listByNode: () => Promise.resolve(standing),
      existingAmong: (_did: string, refs: readonly OwnedRef[]) =>
        Promise.resolve(new Set(refs.filter((ref) => elsewhere.includes(ref)))),
    } as unknown as BlockRepository,
  );
  return { service, taken, ref: ownedRefFrom(one.id) };
}

describe("taking in an offer whose section is not on the note", () => {
  it("writes the row that is there rather than making a second at its reference", async () => {
    const { service, taken, ref } = approving([section]);

    await service.approve(DID, ref);

    expect(taken[0].sections.map((one) => one.standing)).toEqual([true]);
  });

  it("makes one where no row carries that reference at all", async () => {
    const { service, taken, ref } = approving();

    await service.approve(DID, ref);

    expect(taken[0].sections.map((one) => one.standing)).toEqual([false]);
  });
});
