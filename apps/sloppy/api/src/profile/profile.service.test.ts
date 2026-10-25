import { BadRequestException } from "@nestjs/common";
import type { SyrProfilePatch } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import type { AssetLinks } from "../media/asset-link";
import type { MediaService } from "../media/media.service";
import type { Delegation, SyrService } from "../syr/syr.service";
import { ProfileService } from "./profile.service";

const delegation = {
  did: "did:syr:z6MkAda",
  syr_instance_url: "https://store.example",
} as Delegation;

function profiles() {
  const sent: SyrProfilePatch[] = [];
  const syr = {
    updateProfile: async (_: Delegation, patch: SyrProfilePatch) => {
      sent.push(patch);
    },
    readProfile: async () => ({ username: "ada" }),
  } as unknown as SyrService;
  const media = {
    ownPicture: async () => "https://store.example/public/sloppy/a.png",
  } as unknown as MediaService;
  const links = { to: (url: string) => `/assets/${url}` } as AssetLinks;
  return { service: new ProfileService(syr, media, links), sent };
}

describe("a profile patch on a served graph", () => {
  it("refuses a linked picture in words, and sends the store nothing", async () => {
    const { service, sent } = profiles();
    for (const patch of [
      { avatar_url: "https://pictures.example/ada.png" },
      { display_name: "Ada", banner_url: "https://pictures.example/b.png" },
    ]) {
      const refused = service.update(delegation, patch);
      await expect(refused).rejects.toBeInstanceOf(BadRequestException);
      await expect(refused).rejects.toThrow("Choose the file instead");
    }
    expect(sent).toEqual([]);
  });

  it("takes a picture off when its link is cleared", async () => {
    const { service, sent } = profiles();
    await service.update(delegation, { avatar_url: null, banner_url: null });
    expect(sent).toEqual([{ avatar_url: null, banner_url: null }]);
  });

  it("goes on taking a name and a chosen picture as before", async () => {
    const { service, sent } = profiles();
    await service.update(delegation, {
      display_name: "Ada",
      avatar_upload_id: "01J",
    });
    expect(sent).toEqual([
      {
        display_name: "Ada",
        avatar_url: "https://store.example/public/sloppy/a.png",
      },
    ]);
  });
});
