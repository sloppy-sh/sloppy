// The one refusal the number line itself forces; everything else about writing
// a note is exercised against a running server in `domain.integration.test.ts`.
// It cannot live there: reaching the top means owning a branch numbered near
// it, and every automatic branch that graph opened afterwards would follow that
// number rather than its own.

import { BadRequestException } from "@nestjs/common";
import type { Address } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import type { NodeRepository } from "./node.repository";
import { NodeService } from "./node.service";

describe("a branch the server numbers", () => {
  it("is refused in words when nothing could follow the highest one", async () => {
    const highest = String(Number.MAX_SAFE_INTEGER - 1) as Address;
    const repository = {
      childAddresses: () => Promise.resolve([highest]),
    } as unknown as NodeRepository;

    const written = new NodeService(repository).create("did:syr:z6MkAda", {
      title: "",
      tags: [],
    });

    await expect(written).rejects.toBeInstanceOf(BadRequestException);
    await expect(written).rejects.toThrow(/Number a lower one/);
  });
});
