import { describe, expect, it } from "vitest";
import { MediaLibraryRoleSchema, MediaRoleSchema } from "./media.js";

describe("what a picture is for", () => {
  it("offers a library for a note's pictures and one for the ground", () => {
    expect(MediaLibraryRoleSchema.options).toEqual(["block", "wallpaper"]);
  });

  // A picker lists what somebody chooses a picture from, and nobody chooses a
  // profile picture out of the one behind their graph.
  it("offers no library for what a profile and a catalog hold", () => {
    for (const role of MediaRoleSchema.options) {
      if (role === "block" || role === "wallpaper") continue;
      expect(MediaLibraryRoleSchema.safeParse(role).success).toBe(false);
    }
  });
});
