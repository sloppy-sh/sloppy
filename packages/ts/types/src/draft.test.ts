import { describe, expect, it } from "vitest";
import {
  DRAFT_BRANCH_PREFIX,
  draftBranch,
  draftIdIn,
  StandingDraftSchema,
} from "./draft.js";
import { ulid } from "./codecs.js";

describe("the branch a draft is written on", () => {
  it("is the one spelling, read back to the draft it names", () => {
    const id = ulid();
    const branch = draftBranch(id);
    expect(branch.startsWith(DRAFT_BRANCH_PREFIX)).toBe(true);
    expect(draftIdIn(branch)).toBe(id);
  });

  it("names no draft where the branch is somebody's own", () => {
    expect(draftIdIn("main")).toBeUndefined();
    expect(draftIdIn("feature/sloppy/draft/thing")).toBeUndefined();
    expect(draftIdIn(`${DRAFT_BRANCH_PREFIX}not-a-ulid`)).toBeUndefined();
    expect(draftIdIn(`${DRAFT_BRANCH_PREFIX}${ulid()}/again`)).toBeUndefined();
  });
});

describe("a draft standing", () => {
  const standing = {
    id: ulid(),
    root: "/data/drafts/one",
    vault: "/data/drafts/one/.sloppy",
    branch: draftBranch(ulid()),
    from: "0123456789abcdef0123456789abcdef01234567",
  };

  it("carries where the copy is and what it was taken from", () => {
    expect(StandingDraftSchema.parse(standing)).toEqual(standing);
  });

  it("refuses one naming nowhere", () => {
    expect(
      StandingDraftSchema.safeParse({ ...standing, root: "" }).success,
    ).toBe(false);
    expect(
      StandingDraftSchema.safeParse({ ...standing, from: "" }).success,
    ).toBe(false);
    expect(
      StandingDraftSchema.safeParse({ ...standing, id: "nope" }).success,
    ).toBe(false);
  });
});
