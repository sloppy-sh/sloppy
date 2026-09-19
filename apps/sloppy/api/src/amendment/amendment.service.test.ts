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
  recordIdFromOwnedRef,
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
/** The note at the other end of a line the offer sets a look on. */
const OTHER_NOTE = ownedRefFrom(createOwnedRecordId("node", DID));

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
 *  sections that are rows somewhere other than that note's own stack and
 *  `its own` the sections that are on the note itself. */
function approving(
  elsewhere: readonly OwnedRef[] = [],
  itsOwn: readonly OwnedRef[] = [],
  offered: Partial<Amendment> = {},
) {
  const standing: Block[] = itsOwn.map(
    (ref) => ({ id: recordIdFromOwnedRef("block", ref) }) as Block,
  );
  const taken: Approval[] = [];
  const one = { ...offer(), ...offered };
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

describe("taking in an offer", () => {
  it("writes the note's own section where the offer names one", async () => {
    const { service, taken, ref } = approving([], [section]);

    await service.approve(DID, ref);

    expect(taken[0].sections).toMatchObject([{ ref: section, standing: true }]);
  });

  it("makes one where no row carries that reference at all", async () => {
    const { service, taken, ref } = approving();

    await service.approve(DID, ref);

    expect(taken[0].sections).toMatchObject([
      { ref: section, standing: false },
    ]);
  });

  it("adds a section of this note rather than taking a row off another", async () => {
    const { service, taken, ref } = approving([section]);

    await service.approve(DID, ref);

    expect(taken[0].sections[0].standing).toBe(false);
    expect(taken[0].sections[0].ref).not.toBe(section);
  });

  it("takes the looks the offer names in with the rest of it", async () => {
    const { service, taken, ref } = approving([], [section], {
      edges: [{ to: OTHER_NOTE, label: "follows from", direction: "to" }],
    });

    await service.approve(DID, ref);

    expect(taken[0].edges).toEqual([
      { to: OTHER_NOTE, label: "follows from", direction: "to" },
    ]);
  });

  // An offer leaves the note's looks alone rather than taking them off, which
  // is the one thing a write can say and an offer cannot.
  it("says nothing about the looks where the offer names none", async () => {
    const { service, taken, ref } = approving();

    await service.approve(DID, ref);

    expect(taken[0]).not.toHaveProperty("edges");
  });

  it("says nothing about them where every look the offer names is blank", async () => {
    const { service, taken, ref } = approving([], [section], {
      edges: [{ to: OTHER_NOTE }],
    });

    await service.approve(DID, ref);

    expect(taken[0]).not.toHaveProperty("edges");
  });

  // An offer arrives in a file a hand can edit — docs/ARCHITECTURE.md § "A look
  // a person set on a line".
  it("keeps the first of two looks an offer puts on one line", async () => {
    const { service, taken, ref } = approving([], [section], {
      edges: [
        { to: OTHER_NOTE, label: "follows from" },
        { to: OTHER_NOTE, label: "objects to" },
      ],
    });

    await service.approve(DID, ref);

    expect(taken[0].edges).toEqual([{ to: OTHER_NOTE, label: "follows from" }]);
  });
});
