import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  AssetAddressSchema,
  isLinkedPicture,
  LINKED_PICTURE_MAX,
  LinkedPictureSchema,
  PictureSourceSchema,
} from "./media.js";
import {
  linksAPicture,
  namesEachPictureOnce,
  ProfileViewSchema,
  UpdateProfileRequestSchema,
} from "./profile.js";

const DID = "did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE";
const LINK = "https://pictures.example/ada.png";

describe("where a picture is drawn from", () => {
  it("takes an address on the instance and an https link, told apart by scheme", () => {
    expect(PictureSourceSchema.parse("/proxy?ref=abc")).toBe("/proxy?ref=abc");
    expect(PictureSourceSchema.parse(LINK)).toBe(LINK);
    expect(isLinkedPicture(LINK)).toBe(true);
    expect(isLinkedPicture("/proxy?ref=abc")).toBe(false);
  });

  it("refuses a link that is not https on a named host", () => {
    for (const src of [
      "http://pictures.example/ada.png",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "file:///etc/passwd",
      "https:ada.png",
      "https:/pictures.example/ada.png",
      "https://localhost/ada.png",
      "https://127.0.0.1/ada.png",
      "media/up1.png",
      `https://pictures.example/${"a".repeat(LINKED_PICTURE_MAX)}`,
    ]) {
      expect(PictureSourceSchema.safeParse(src).success).toBe(false);
      expect(isLinkedPicture(src)).toBe(false);
    }
  });

  it("still takes every address it took before, unchanged", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.string().map((rest) => `/a${rest}`),
        ),
        (src) => {
          const before = AssetAddressSchema.safeParse(src);
          const after = PictureSourceSchema.safeParse(src);
          if (before.success) {
            expect(after.success && after.data).toBe(before.data);
          } else {
            expect(after.success).toBe(isLinkedPicture(src));
          }
        },
      ),
    );
  });

  it("takes nothing new but a linked picture", () => {
    fc.assert(
      fc.property(fc.webUrl({ validSchemes: ["https", "http"] }), (src) => {
        const after = PictureSourceSchema.safeParse(src);
        if (after.success) expect(LinkedPictureSchema.parse(src)).toBe(src);
        expect(after.success).toBe(isLinkedPicture(src));
      }),
    );
  });
});

describe("a profile as a store reports it", () => {
  it("reads one with no linked picture exactly as it did", () => {
    for (const view of [
      {
        did: DID,
        username: DID,
        display_name: null,
        bio: null,
        avatar_src: null,
        banner_src: null,
      },
      {
        did: DID,
        username: "ada",
        display_name: "Ada Lovelace",
        bio: "Notes on the engine.",
        avatar_src: "/proxy?ref=one",
        banner_src: "/media/banner",
      },
    ]) {
      expect(ProfileViewSchema.parse(view)).toEqual(view);
    }
  });

  it("carries a linked avatar and banner", () => {
    const view = ProfileViewSchema.parse({
      did: DID,
      username: DID,
      display_name: null,
      bio: null,
      avatar_src: LINK,
      banner_src: LINK,
    });
    expect(view.avatar_src).toBe(LINK);
    expect(view.banner_src).toBe(LINK);
  });
});

describe("a patch to a profile", () => {
  it("parses one written before links exactly as it did", () => {
    for (const patch of [
      {},
      { display_name: "Ada", bio: null },
      { avatar_upload_id: "up1", banner_upload_id: null },
    ]) {
      expect(UpdateProfileRequestSchema.parse(patch)).toEqual(patch);
    }
  });

  it("names a picture by a link, or clears one", () => {
    expect(
      UpdateProfileRequestSchema.parse({ avatar_url: LINK, banner_url: null }),
    ).toEqual({ avatar_url: LINK, banner_url: null });
    expect(
      UpdateProfileRequestSchema.safeParse({
        avatar_url: "http://pictures.example/ada.png",
      }).success,
    ).toBe(false);
  });

  it("names each picture one way", () => {
    expect(
      namesEachPictureOnce({ avatar_url: LINK, banner_upload_id: "up2" }),
    ).toBe(true);
    expect(
      namesEachPictureOnce({ avatar_url: LINK, avatar_upload_id: "up1" }),
    ).toBe(false);
    expect(
      namesEachPictureOnce({ banner_url: null, banner_upload_id: "up2" }),
    ).toBe(false);
  });

  it("says when it links a picture, and not when it clears one", () => {
    expect(linksAPicture({ avatar_url: LINK })).toBe(true);
    expect(linksAPicture({ banner_url: LINK })).toBe(true);
    expect(linksAPicture({ avatar_url: null, banner_url: null })).toBe(false);
    expect(linksAPicture({ avatar_upload_id: "up1" })).toBe(false);
  });
});
