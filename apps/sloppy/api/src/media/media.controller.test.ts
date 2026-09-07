// Which library a picker is asking for, and what a request naming none gets.

import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { AuthedRequest } from "../auth/authed-request";
import type { AppConfigService } from "../config/app-config.service";
import type { Delegation } from "../syr/syr.service";
import type { HeldPictures } from "./held-pictures";
import { MediaController } from "./media.controller";
import type { MediaService } from "./media.service";

const DELEGATION: Delegation = {
  did: "did:syr:z6MkuVRBZ1913zrZgc4nnA3Zs9MEEf84VUN8kgTD6QoqNiu9",
  syr_instance_url: "https://syr.example",
  delegate_public_key: "z6Mkok",
  access_token: "token",
};

const REQUEST = { delegation: DELEGATION } as AuthedRequest;

function listing() {
  const ownPictures = vi.fn().mockResolvedValue([]);
  const controller = new MediaController(
    { ownPictures } as unknown as MediaService,
    {} as HeldPictures,
    {} as AppConfigService,
  );
  return { ownPictures, controller };
}

describe("the pictures a picker is offered", () => {
  it("names the note library where the request named none", async () => {
    const { ownPictures, controller } = listing();

    await controller.pictures(REQUEST);

    expect(ownPictures).toHaveBeenCalledWith(DELEGATION, "block");
  });

  it("names the ground's own where the request asked for it", async () => {
    const { ownPictures, controller } = listing();

    await controller.pictures(REQUEST, "wallpaper");

    expect(ownPictures).toHaveBeenCalledWith(DELEGATION, "wallpaper");
  });

  // A profile picture and a catalog entry are not chosen out of a picker, so
  // neither is a library this route will list.
  it.each(["avatar", "emoji", "notARole"])("refuses %s", (role) => {
    const { ownPictures, controller } = listing();

    expect(() => controller.pictures(REQUEST, role)).toThrow(
      BadRequestException,
    );
    expect(ownPictures).not.toHaveBeenCalled();
  });
});
