// The sweep that ends the window for somebody who deleted a branch and never
// came back.

import { describe, expect, it } from "vitest";
import type { DbService } from "../db/db.service";
import { DeletedSweep } from "./deleted-sweep";
import type { NodeService } from "./node.service";

const open = { whenOpen: () => Promise.resolve() } as unknown as DbService;

describe("sweeping what nobody came back for", () => {
  it("sweeps everybody once the store is open", async () => {
    let swept = 0;
    const nodes = {
      sweepEveryone: () => {
        swept += 1;
        return Promise.resolve(2);
      },
    } as unknown as NodeService;

    expect(await new DeletedSweep(open, nodes).run()).toBe(2);
    expect(swept).toBe(1);
  });

  it("says so and carries on when the store will not answer", async () => {
    const nodes = {
      sweepEveryone: () => Promise.reject(new Error("the store is not here")),
    } as unknown as NodeService;

    expect(await new DeletedSweep(open, nodes).run()).toBe(0);
  });
});
