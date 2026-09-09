import { describe, expect, it } from "vitest";
import { extensionFor, mimeForExtension, rewriteUploads } from "./uploads";

describe("the pictures a section names", () => {
  it("renames every upload the map knows, however deep it is nested", () => {
    const document = {
      type: "doc",
      content: [
        { type: "picture", attrs: { upload_id: "one", width: 8 } },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "ink", attrs: { raster_upload_id: "two" } }],
            },
          ],
        },
      ],
    };

    const written = rewriteUploads(
      document,
      new Map([
        ["one", "did:syr:z6Mk1/01A"],
        ["two", "did:syr:z6Mk1/01B"],
      ]),
    );

    expect(written).toEqual({
      type: "doc",
      content: [
        {
          type: "picture",
          attrs: { upload_id: "did:syr:z6Mk1/01A", width: 8 },
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "ink",
                  attrs: { raster_upload_id: "did:syr:z6Mk1/01B" },
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("leaves an upload the map says nothing about exactly as it was", () => {
    const document = {
      type: "doc",
      content: [{ type: "picture", attrs: { upload_id: "gone" } }],
    };

    expect(rewriteUploads(document, new Map([["one", "two"]]))).toEqual(
      document,
    );
  });

  it("does not touch a document when nothing is being renamed", () => {
    const document = { type: "doc", content: [] };

    expect(rewriteUploads(document, new Map())).toBe(document);
  });
});

describe("what a picture's file is called", () => {
  it("names each type this build writes, and reads the name back", () => {
    for (const mimeType of [
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
    ]) {
      expect(mimeForExtension(extensionFor(mimeType))).toBe(mimeType);
    }
  });

  it("reads `jpeg` as the type `jpg` is written for", () => {
    expect(mimeForExtension("JPEG")).toBe("image/jpeg");
  });

  it("says nothing about a suffix this build would not have written", () => {
    expect(mimeForExtension("svg")).toBeUndefined();
  });
});
