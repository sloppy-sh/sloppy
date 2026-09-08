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
  const NOTHING = { links: [], aliases: [] };

  it("carries no depth, and roots at the region", () => {
    const written = publishedNodeOf(
      note({ address: "1a1", depth: 3, parent: at(AVA, "PARENT") }),
      region,
      NOTHING,
    );
    expect(written).not.toHaveProperty("depth");
    expect(written.origin).toBe(region.root);
    expect(written.parent).toBe(at(AVA, "PARENT"));
  });

  it("carries the shape its author gave the mark", () => {
    const written = publishedNodeOf(
      note({
        address: "1a1",
        depth: 3,
        appearance: {
          ring_weight: "heavy",
          ring_style: "dashed",
          mark_radius: "large",
          mark_scale: 1.34,
        },
      }),
      region,
      NOTHING,
    );
    expect(written.look).toEqual({
      ring_weight: "heavy",
      ring_style: "dashed",
      mark_radius: "large",
      mark_scale: 1.34,
    });
  });

  // The pictures stay behind — DESIGN.md § "A note's look never uses colour" —
  // so a mark shaped only by one is a mark a peer draws unstyled.
  it("sends no picture, and no look at all where that is the whole of one", () => {
    const written = publishedNodeOf(
      note({
        address: "1a1",
        depth: 3,
        appearance: {
          preview: `${AVA}/PICTURE`,
          preview_more: [`${AVA}/SECOND`],
          preview_size: "large",
          preview_cover: 0.6,
          preview_every: 5,
          preview_transition: "fade",
        },
      }),
      region,
      NOTHING,
    );
    expect(written).not.toHaveProperty("look");
    expect(JSON.stringify(written)).not.toContain("PICTURE");
  });

  it("sends no look for a mark nobody shaped", () => {
    expect(
      publishedNodeOf(note({ address: "1a1", depth: 3 }), region, NOTHING),
    ).not.toHaveProperty("look");
  });

  // A publication rooted below depth 1 has a parent outside it, and naming one
  // would say a note exists that nobody published. Which note is the root is
  // read off the ref the region is rooted at, never off an address a person
  // writes.
  it("names no parent on the region's own root", () => {
    const written = publishedNodeOf(
      note({
        id: new RecordId("node", {
          created_by: AVA,
          id: "RGNRT".padEnd(26, "0"),
        }),
        address: "1a",
        depth: 2,
        parent: at(AVA, "AWAY"),
      }),
      region,
      NOTHING,
    );
    expect(written.parent).toBeUndefined();
    expect(written.origin).toBe(region.root);
  });

  // A reader cites the number they were shown, and the author may since have
  // carried the note somewhere else — including out of another branch, which is
  // an address a reader of an earlier version was given.
  it("carries every address the note has been moved away from", () => {
    const written = publishedNodeOf(
      note({ address: "1a1", depth: 3 }),
      region,
      {
        links: [],
        aliases: ["1a2", "2c"],
      },
    );
    expect(written.aliases).toEqual(["1a2", "2c"]);
  });

  it("says nothing of old addresses for a note that has never moved", () => {
    expect(
      publishedNodeOf(note({ address: "1a1", depth: 3 }), region, NOTHING),
    ).not.toHaveProperty("aliases");
  });

  // Every ref a peer receives names a note they may go and read, and a
  // derivation is over writing the publication redacts on its way out — so the
  // lines a pulled note draws are the ones a hand drew. DESIGN.md § Edges says
  // so as the gap it is; this is what keeps the gap from closing by accident.
  it("carries none of what the writing names, published or not", () => {
    const written = publishedNodeOf(
      note({
        address: "1a",
        depth: 2,
        links: [PUBLISHED_NOTE],
        references: [PUBLISHED_NOTE, PRIVATE_NOTE],
      }),
      region,
      { links: [PUBLISHED_NOTE], aliases: [] },
    );
    expect(written).not.toHaveProperty("references");
    expect(written.links).toEqual([PUBLISHED_NOTE]);
  });
});
