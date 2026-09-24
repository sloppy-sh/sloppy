import { NotFoundException } from "@nestjs/common";
import {
  type Principal,
  type SetWhereaboutsRequest,
  type Whereabouts,
  parseWhereabouts,
} from "@sloppy/types";
import { describe, expect, it } from "vitest";
import type { AuthedRequest } from "../auth/authed-request";
import {
  WhereaboutsController,
  WhereaboutsWellKnownController,
} from "./whereabouts.controller";
import type { WhereaboutsService } from "./whereabouts.service";

const ALICE = "mailto:alice@example.com" as Principal;

const HERS: Whereabouts = {
  principal: ALICE,
  domain: "alice.example",
  instance: "https://home.example",
};

function saying(said: Whereabouts | null) {
  const written: { by: Principal; said: SetWhereaboutsRequest }[] = [];
  const service = {
    declared: () => Promise.resolve(said),
    declare: (by: Principal, request: SetWhereaboutsRequest) => {
      written.push({ by, said: request });
      return Promise.resolve({ principal: by, ...request } as Whereabouts);
    },
  } as unknown as WhereaboutsService;
  return { service, written };
}

const signedIn = { viewer: { did: ALICE } } as unknown as AuthedRequest;

describe("the declaration this instance serves", () => {
  it("is read back as one about the person it was asked about", async () => {
    const { service } = saying(HERS);
    const served = await new WhereaboutsWellKnownController(service).declared(
      encodeURIComponent(ALICE),
    );
    expect(parseWhereabouts(served, ALICE)).toEqual(HERS);
  });

  it("is not there for somebody who has declared nothing here", async () => {
    const { service } = saying(null);
    await expect(
      new WhereaboutsWellKnownController(service).declared(
        encodeURIComponent(ALICE),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("writing a declaration", () => {
  it("writes the caller's own and nobody else's", async () => {
    const { service, written } = saying(null);
    const said = await new WhereaboutsController(service).declare(signedIn, {
      principal: "mailto:eve@example.com",
      domain: "alice.example",
      instance: "https://home.example",
    });
    expect(said.principal).toBe(ALICE);
    expect(written).toEqual([
      {
        by: ALICE,
        said: { domain: "alice.example", instance: "https://home.example" },
      },
    ]);
  });

  it("refuses an instance that is not one address", async () => {
    const { service } = saying(null);
    expect(() =>
      new WhereaboutsController(service).declare(signedIn, {
        instance: "https://home.example/graphs?of=alice",
      }),
    ).toThrow(/instance address/);
  });
});
