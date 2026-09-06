// What a section written in two places does. Every other road into a stack is
// exercised against a running server in `../node/domain.integration.test.ts`;
// this is the one answer that turns on a reading the writer arrived with.

import { ConflictException } from "@nestjs/common";
import {
  type Block,
  type BlockDocument,
  createOwnedRecordId,
  emptyDocument,
  type OwnedRef,
  ownedRefFrom,
} from "@sloppy/types";
import { describe, expect, it } from "vitest";
import type { NodeRepository } from "../node/node.repository";
import type { BlockPatch, BlockRepository } from "./block.repository";
import { BlockService } from "./block.service";

const ADA = "did:syr:z6MkAda";
const NODE = ownedRefFrom(createOwnedRecordId("node", ADA));
const READ_AT = "2026-01-01T00:00:00.000Z";
const WRITTEN_AT = "2026-01-01T00:00:05.000Z";

const prose = (line: string): BlockDocument => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: line }] }],
});

/** Nothing here names another note, so no derivation is reached and the note's
 *  own row is never asked for. */
const nodes = {} as NodeRepository;

function sectionOn(updatedAt: string) {
  const id = createOwnedRecordId("block", ADA);
  let held: Block = {
    id,
    created_by: ADA,
    node: NODE,
    ord: "a0",
    content: emptyDocument(),
    created_at: READ_AT,
    updated_at: updatedAt,
  };
  const patches: BlockPatch[] = [];
  const blocks = {
    nodeOf: () => Promise.resolve(held.node),
    find: () => Promise.resolve(held),
    listByNode: () => Promise.resolve([held]),
    patch: (_did: string, _ref: OwnedRef, changes: BlockPatch) => {
      patches.push(changes);
      held = { ...held, ...changes, updated_at: WRITTEN_AT };
      return Promise.resolve(held);
    },
  } as unknown as BlockRepository;
  return {
    ref: ownedRefFrom(id),
    patches,
    service: new BlockService(blocks, nodes),
  };
}

describe("a section written in two places", () => {
  it("refuses the write that read it before the other one landed", async () => {
    const { service, ref, patches } = sectionOn(WRITTEN_AT);

    const written = service.update(ADA, ref, {
      content: prose("What the second device still thinks is there."),
      expects: READ_AT,
    });

    await expect(written).rejects.toBeInstanceOf(ConflictException);
    await expect(written).rejects.toThrow(/written somewhere else/);
    expect(patches).toEqual([]);
  });

  it("refuses a move made against a reading that is out of date", async () => {
    const { service, ref, patches } = sectionOn(WRITTEN_AT);

    await expect(
      service.update(ADA, ref, { after: null, expects: READ_AT }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(patches).toEqual([]);
  });

  it("writes when the reading is the one the section is at", async () => {
    const { service, ref } = sectionOn(READ_AT);
    const rewritten = prose("What this device wrote.");

    const view = await service.update(ADA, ref, {
      content: rewritten,
      expects: READ_AT,
    });

    expect(view.content).toEqual(rewritten);
    // The stamp the next write from this device has to arrive with.
    expect(view.updated_at).toBe(WRITTEN_AT);
  });

  it("moves a section and answers with the stamp its next write needs", async () => {
    const { service, ref } = sectionOn(READ_AT);

    const view = await service.update(ADA, ref, {
      after: null,
      expects: READ_AT,
    });

    expect(view.updated_at).toBe(WRITTEN_AT);
  });

  it("writes with no reading given at all", async () => {
    const { service, ref } = sectionOn(WRITTEN_AT);
    const rewritten = prose("A writer that asks for no precondition.");

    const view = await service.update(ADA, ref, { content: rewritten });

    expect(view.content).toEqual(rewritten);
  });
});
