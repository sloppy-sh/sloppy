// Carrying a section out of one note into another: where it lands in the stack
// it arrives in, and what is refused rather than carried.

import { BadRequestException, ConflictException } from "@nestjs/common";
import {
  type Block,
  type BlockDocument,
  compareOrd,
  createOwnedRecordId,
  emptyDocument,
  type Node,
  type OwnedRef,
  ownedRefFrom,
} from "@sloppy/types";
import { describe, expect, it } from "vitest";
import type { NodeRepository } from "../node/node.repository";
import type { BlockPatch, BlockRepository } from "./block.repository";
import { BlockService } from "./block.service";

const ADA = "did:syr:z6MkAda";
const READ_AT = "2026-01-01T00:00:00.000Z";
const WRITTEN_AT = "2026-01-01T00:00:05.000Z";

const HERE = ownedRefFrom(createOwnedRecordId("node", ADA));
const THERE = ownedRefFrom(createOwnedRecordId("node", ADA));

const prose = (line: string): BlockDocument => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: line }] }],
});

function section(node: OwnedRef, ord: string, content?: BlockDocument): Block {
  return {
    id: createOwnedRecordId("block", ADA),
    created_by: ADA,
    node,
    ord,
    content: content ?? emptyDocument(),
    created_at: READ_AT,
    updated_at: READ_AT,
  };
}

/** The two notes and their stacks, with `reachable` saying which notes the
 *  writer can still write into — one that is deleted, or somebody else's,
 *  answers nothing. */
function store(rows: Block[], reachable: readonly OwnedRef[] = [HERE, THERE]) {
  const at = (ref: OwnedRef) =>
    rows.findIndex((row) => ownedRefFrom(row.id) === ref);
  const blocks = {
    nodeOf: (_did: string, ref: OwnedRef) =>
      Promise.resolve(at(ref) < 0 ? null : rows[at(ref)].node),
    find: (_did: string, ref: OwnedRef) =>
      Promise.resolve(at(ref) < 0 ? null : rows[at(ref)]),
    listByNode: (node: OwnedRef) =>
      Promise.resolve(
        rows
          .filter((row) => row.node === node)
          .sort((a, b) => compareOrd(a.ord, b.ord)),
      ),
    patch: (_did: string, ref: OwnedRef, changes: BlockPatch) => {
      const found = at(ref);
      rows[found] = { ...rows[found], ...changes, updated_at: WRITTEN_AT };
      return Promise.resolve(rows[found]);
    },
  } as unknown as BlockRepository;
  const nodes = {
    find: (_did: string, ref: OwnedRef) =>
      Promise.resolve(reachable.includes(ref) ? ({} as Node) : null),
  } as unknown as NodeRepository;
  return new BlockService(blocks, nodes);
}

/** A note's stack as a reader sees it: its sections in `ord` order. */
const stackOf = (rows: readonly Block[], node: OwnedRef): OwnedRef[] =>
  rows
    .filter((row) => row.node === node)
    .sort((a, b) => compareOrd(a.ord, b.ord))
    .map((row) => ownedRefFrom(row.id));

describe("a section carried into another note", () => {
  it("lands after the section it was dropped on, keeping what it says", async () => {
    const written = prose("The paragraph that goes with the other note.");
    const carried = section(HERE, "a0", written);
    const top = section(THERE, "a0");
    const under = section(THERE, "a1");
    const rows = [carried, top, under];
    const service = store(rows);

    const view = await service.update(ADA, ownedRefFrom(carried.id), {
      node: THERE,
      after: ownedRefFrom(top.id),
    });

    expect(view.node).toBe(THERE);
    expect(view.content).toEqual(written);
    expect(stackOf(rows, HERE)).toEqual([]);
    expect(stackOf(rows, THERE)).toEqual([
      ownedRefFrom(top.id),
      ownedRefFrom(carried.id),
      ownedRefFrom(under.id),
    ]);
  });

  it("lands on top of the note it arrives in when nothing is named", async () => {
    const carried = section(HERE, "a0");
    const standing = section(THERE, "a0");
    const rows = [carried, standing];
    const service = store(rows);

    await service.update(ADA, ownedRefFrom(carried.id), { node: THERE });

    expect(stackOf(rows, THERE)).toEqual([
      ownedRefFrom(carried.id),
      ownedRefFrom(standing.id),
    ]);
  });

  it("comes back to the note it came from, under the section left there", async () => {
    const carried = section(HERE, "a0");
    const stayed = section(HERE, "a1");
    const rows = [carried, stayed];
    const service = store(rows);
    const ref = ownedRefFrom(carried.id);

    await service.update(ADA, ref, { node: THERE });
    expect(stackOf(rows, HERE)).toEqual([ownedRefFrom(stayed.id)]);

    await service.update(ADA, ref, {
      node: HERE,
      after: ownedRefFrom(stayed.id),
    });

    expect(stackOf(rows, THERE)).toEqual([]);
    expect(stackOf(rows, HERE)).toEqual([ownedRefFrom(stayed.id), ref]);
  });

  it("is refused when the note it is going to is not the writer's", async () => {
    const carried = section(HERE, "a0");
    const rows = [carried];
    const service = store(rows, [HERE]);

    const write = service.update(ADA, ownedRefFrom(carried.id), {
      node: THERE,
    });

    await expect(write).rejects.toBeInstanceOf(BadRequestException);
    await expect(write).rejects.toThrow(/not here/);
    expect(stackOf(rows, HERE)).toEqual([ownedRefFrom(carried.id)]);
  });

  it("is refused when the section it was dropped on is not in that note", async () => {
    const carried = section(HERE, "a0");
    const alongside = section(HERE, "a1");
    const rows = [carried, alongside];
    const service = store(rows);

    const write = service.update(ADA, ownedRefFrom(carried.id), {
      node: THERE,
      after: ownedRefFrom(alongside.id),
    });

    await expect(write).rejects.toBeInstanceOf(BadRequestException);
    await expect(write).rejects.toThrow(/not in that note/);
    expect(stackOf(rows, HERE)).toEqual([
      ownedRefFrom(carried.id),
      ownedRefFrom(alongside.id),
    ]);
  });

  it("is refused when the writer read the section before somebody else wrote it", async () => {
    const carried = { ...section(HERE, "a0"), updated_at: WRITTEN_AT };
    const rows = [carried];
    const service = store(rows);

    const write = service.update(ADA, ownedRefFrom(carried.id), {
      node: THERE,
      expects: READ_AT,
    });

    await expect(write).rejects.toBeInstanceOf(ConflictException);
    expect(stackOf(rows, HERE)).toEqual([ownedRefFrom(carried.id)]);
  });

  it("is refused when the section was carried away before this write landed", async () => {
    const carried = section(HERE, "a0");
    const rows = [carried];
    const service = store(rows);
    const ref = ownedRefFrom(carried.id);
    // A write that read the section in `HERE` reaches the store after another
    // carried it into `THERE`.
    const behind = service.update(ADA, ref, { after: null });
    rows[0] = { ...rows[0], node: THERE };

    await expect(behind).rejects.toBeInstanceOf(ConflictException);
    await expect(behind).rejects.toThrow(/in another note now/);
  });

  it("leaves a section named in the same note alone where it sits", async () => {
    const top = section(HERE, "a0");
    const under = section(HERE, "a1");
    const rows = [top, under];
    const service = store(rows);

    await service.update(ADA, ownedRefFrom(under.id), { node: HERE });

    expect(stackOf(rows, HERE)).toEqual([
      ownedRefFrom(top.id),
      ownedRefFrom(under.id),
    ]);
  });
});
