import { BadRequestException } from "@nestjs/common";
import { PageCursorSchema } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import { markPage, pageMark } from "./cursor";

const RUN = "did:syr:z6MkuVRBZ1913zrZgc4nnA3Zs9MEEf84VUN8kgTD6QoqNiu9/01ABC";

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
