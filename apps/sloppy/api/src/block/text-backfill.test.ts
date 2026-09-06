// Deriving the words of sections stored before anything read them.

import { RecordId } from "surrealdb";
import { describe, expect, it } from "vitest";
import type { DbService } from "../db/db.service";
import type { BlockRepository, Underived } from "./block.repository";
import { TextBackfill } from "./text-backfill";

const open = { whenOpen: () => Promise.resolve() } as unknown as DbService;

const section = (at: number): Underived => ({
  id: new RecordId("block", { created_by: "did:syr:z6MkAda", id: `0${at}` }),
  content: {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: `${at}` }] },
    ],
  },
});

/** A store holding `pending` sections nothing has derived words for, answering
 *  `perPass` of them at a time. */
function holding(pending: number, perPass: number) {
  const left = Array.from({ length: pending }, (_, at) => section(at));
  const filled: Underived[] = [];
  const blocks = {
    withoutText: (limit: number) =>
      Promise.resolve(left.slice(0, Math.min(limit, perPass))),
    fillText: (derived: readonly Underived[]) => {
      filled.push(...derived);
      left.splice(0, derived.length);
      return Promise.resolve();
    },
  } as unknown as BlockRepository;
  return { filled, backfill: new TextBackfill(open, blocks) };
}

describe("the words of sections written before anything read them", () => {
  it("derives every one of them, a pass at a time", async () => {
    const { backfill, filled } = holding(5, 2);

    expect(await backfill.run()).toBe(5);
    expect(filled).toHaveLength(5);
  });

  it("has nothing to do where every section has been read", async () => {
    const { backfill, filled } = holding(0, 2);

    expect(await backfill.run()).toBe(0);
    expect(filled).toEqual([]);
  });
});
