import { BadRequestException } from "@nestjs/common";
import { type OwnedRef, PageCursorSchema } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import { markPage, pageMark, pinnedVersion, subtreeRun } from "./cursor";

const RUN = "did:syr:z6MkuVRBZ1913zrZgc4nnA3Zs9MEEf84VUN8kgTD6QoqNiu9/01ABC";
const AVA = "did:syr:z6MkuVRBZ1913zrZgc4nnA3Zs9MEEf84VUN8kgTD6QoqNiu9";
const PUBLICATION = `${AVA}/01JBQK8XN4T7YVGZ2M5W9RCFDH` as OwnedRef;
const VERSION = `${AVA}/01JBQK9TZ2H6BNPX4Q8VKMSRDE` as OwnedRef;
const OTHER = `${AVA}/01JBQKAF5W3XGDT7YHNC2VJQ8M` as OwnedRef;

describe("where a page resumes", () => {
  it("comes back as it went out", () => {
    const cursor = markPage({ of: RUN, at: "1a1", ord: "a0" });
    expect(PageCursorSchema.safeParse(cursor).success).toBe(true);
    expect(pageMark(cursor, RUN)).toEqual({ of: RUN, at: "1a1", ord: "a0" });
  });

  it("is absent where the first page was asked for", () => {
    expect(pageMark(undefined, RUN)).toBeUndefined();
    expect(pageMark("", RUN)).toBeUndefined();
  });

  // A cursor is minted by the instance that served the page, so one spent on
  // another answer is somebody typing rather than reading.
  it("is refused on a run it was not minted for", () => {
    expect(() =>
      pageMark(markPage({ of: RUN, at: "1a" }), "elsewhere"),
    ).toThrow(BadRequestException);
  });

  it.each([
    "not-a-cursor",
    Buffer.from("{}").toString("base64url"),
  ])("refuses %s", (raw) => {
    expect(() => pageMark(raw, RUN)).toThrow(BadRequestException);
  });
});

describe("the version a region's pages are held to", () => {
  it("comes back off a cursor the run minted", () => {
    const cursor = markPage({ of: subtreeRun(PUBLICATION, VERSION), at: "1a" });
    expect(pinnedVersion(cursor, PUBLICATION)).toBe(VERSION);
  });

  it("is absent where the first page was asked for, leaving the newest to answer", () => {
    expect(pinnedVersion(undefined, PUBLICATION)).toBeUndefined();
    expect(pinnedVersion("", PUBLICATION)).toBeUndefined();
  });

  it("refuses a cursor minted for another publication", () => {
    const cursor = markPage({ of: subtreeRun(OTHER, VERSION), at: "1a" });
    expect(() => pinnedVersion(cursor, PUBLICATION)).toThrow(
      BadRequestException,
    );
  });

  // The chain listing and the comparison mint their own runs against the same
  // publication, and neither one names the single version a region is read at.
  it.each([
    ["a listing", PUBLICATION],
    ["a comparison", `${PUBLICATION}|${VERSION}|${OTHER}`],
  ])("refuses a cursor from %s", (_what, of) => {
    expect(() => pinnedVersion(markPage({ of, seq: 2 }), PUBLICATION)).toThrow(
      BadRequestException,
    );
  });
});
