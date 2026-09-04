import {
  type BlockDocument,
  type DocumentNode,
  EMOJI_UPLOAD_ATTR,
  type Node,
  parseNode,
} from "@sloppy/types";
import { RecordId } from "surrealdb";
import { describe, expect, it } from "vitest";
import {
  citedEmoji,
  publishedDocument,
  publishedNodeOf,
  type Snapshotted,
} from "./snapshot";

const AVA = "did:syr:z6MkuVRBZ1913zrZgc4nnA3Zs9MEEf84VUN8kgTD6QoqNiu9";
const BRAM = "did:syr:z6MkfLZ1t2rQKJdZ5Xp3n8Y6WvTqHc4bAe9mNs1uRvGxQpKz";
/** Crockford base32 without I, L, O or U, which is what a ULID is. */
const at = (did: string, tag: string) => `${did}/${tag.padEnd(26, "0")}`;
const PRIVATE = at(AVA, "PRVATEPCTRE");
const COPY = at(AVA, "PBLCCPY");
const KITE_COPY = at(AVA, "EMJKTECPY");
const PUBLISHED_NOTE = at(AVA, "PBNTE");
const PRIVATE_NOTE = at(AVA, "PRVNTE");

const held: Snapshotted = {
  copyOf: (uploadId) => (uploadId === PRIVATE ? COPY : undefined),
  emojiOf: (shortcode) => (shortcode === "kite" ? KITE_COPY : undefined),
  reaches: (note) => note === PUBLISHED_NOTE,
};

function doc(...content: DocumentNode[]): BlockDocument {
  return { type: "doc", content };
}

const emoji = (name: string, src: string): DocumentNode => ({
  type: "emoji",
  attrs: { name, char: "", src, sticker: false },
});

const reference = (note: string, label: string): DocumentNode => ({
  type: "reference",
  attrs: { note, label },
});

describe("the custom emoji a section draws", () => {
  it("names a custom emoji by its shortcode and leaves a glyph alone", () => {
    expect(
      citedEmoji(
        doc({
          type: "paragraph",
          content: [
            emoji("kite", "/proxy?ref=abc"),
            { type: "emoji", attrs: { name: "smile", char: "🙂", src: "" } },
          ],
        }),
      ),
    ).toEqual(["kite"]);
  });
});

describe("a section as a peer receives it", () => {
  it("draws its pictures from the publication's own copies", () => {
    expect(
      publishedDocument(
        doc({ type: "picture", attrs: { upload_id: PRIVATE } }),
        held,
      ).content[0].attrs,
    ).toEqual({ upload_id: COPY });
  });

  it("copies a picture an element kind this build cannot draw carries", () => {
    const written = publishedDocument(
      doc({
        type: "diagram-from-a-later-build",
        attrs: { panels: [{ upload_id: PRIVATE }] },
      }),
      held,
    );
    expect(written.content[0].attrs).toEqual({ panels: [{ upload_id: COPY }] });
  });

  it("refuses to write a section around a picture with no copy", () => {
    expect(() =>
      publishedDocument(
        doc({ type: "picture", attrs: { upload_id: at(AVA, "NCPY") } }),
        held,
      ),
    ).toThrow();
  });

  // The address on a written emoji is minted for the author's own catalog, so a
  // peer holding it would be reading a catalog its author can empty.
  it("draws an emoji from the copy and never from the address it was written with", () => {
    const written = publishedDocument(
      doc({ type: "paragraph", content: [emoji("kite", "/proxy?ref=abc")] }),
      held,
    );
    expect(written.content[0].content?.[0].attrs).toEqual({
      name: "kite",
      char: "",
      sticker: false,
      [EMOJI_UPLOAD_ATTR]: KITE_COPY,
    });
  });

  it("keeps the name and drops the address where the catalog no longer claims it", () => {
    const written = publishedDocument(
      doc({ type: "paragraph", content: [emoji("gone", "/proxy?ref=abc")] }),
      held,
    );
    expect(written.content[0].content?.[0].attrs).toEqual({
      name: "gone",
      char: "",
      sticker: false,
    });
  });

  it("carries a citation of a note that was published", () => {
    expect(
      publishedDocument(doc(reference(PUBLISHED_NOTE, "A thought")), held)
        .content[0].attrs,
    ).toEqual({ note: PUBLISHED_NOTE, label: "A thought" });
  });

  // The words a note is cited under are the CITED note's title, so a citation
  // the reader cannot follow must lose both halves.
  it("carries neither the note nor its title where nobody published it", () => {
    expect(
      publishedDocument(
        doc(reference(PRIVATE_NOTE, "Something unpublished")),
        held,
      ).content[0].attrs,
    ).toEqual({ note: "", label: "" });
  });

  it("withholds one cited from a mark just as deeply", () => {
    const written = publishedDocument(
      doc({
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "there",
            marks: [
              { type: "link", attrs: { note: PRIVATE_NOTE, label: "Secret" } },
            ],
          },
        ],
      }),
      held,
    );
    expect(written.content[0].content?.[0].marks?.[0].attrs).toEqual({
      note: "",
      label: "",
    });
  });

  it("withholds one somebody else wrote", () => {
    expect(
      publishedDocument(doc(reference(at(BRAM, "THERS"), "Theirs")), held)
        .content[0].attrs,
    ).toEqual({ note: "", label: "" });
  });
});

function note(of: Partial<Node> & { address: string; depth: number }): Node {
  return parseNode({
    id: new RecordId("node", { created_by: AVA, id: "NDE".padEnd(26, "0") }),
    created_by: AVA,
    origin: at(AVA, "RGNRT"),
    title: "A thought",
    tags: [],
    links: [],
    published: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    ...of,
  });
}

describe("a note as a version froze it", () => {
  const region = { root: at(AVA, "RGNRT"), address: "1a" };

  it("carries no depth and no look, and roots at the region", () => {
    const written = publishedNodeOf(
      note({
        address: "1a1",
        depth: 3,
        parent: at(AVA, "PARENT"),
        appearance: { ring_weight: "heavy" },
      }),
      region,
      [],
    );
    expect(written).not.toHaveProperty("depth");
    expect(written).not.toHaveProperty("appearance");
    expect(written.origin).toBe(region.root);
    expect(written.parent).toBe(at(AVA, "PARENT"));
  });

  // A publication rooted below depth 1 has a parent outside it, and naming one
  // would say a note exists that nobody published.
  it("names no parent on the region's own root", () => {
    const written = publishedNodeOf(
      note({
        address: "1a",
        depth: 2,
        parent: at(AVA, "AWAY"),
      }),
      region,
      [],
    );
    expect(written.parent).toBeUndefined();
    expect(written.origin).toBe(region.root);
  });
});
