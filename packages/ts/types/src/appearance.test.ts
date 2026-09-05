import { describe, expect, it } from "vitest";
import {
  isUnstyled,
  MARK_RADII,
  NodeAppearanceSchema,
  PREVIEW_SIZES,
  RING_STYLES,
  RING_WEIGHTS,
  resolveAppearance,
  seriesChannels,
  WrittenAppearanceSchema,
} from "./appearance.js";
import { NodeSchema } from "./node.js";
import {
  PICTURE_TRANSITIONS,
  PICTURE_TURN_DEFAULT,
  PICTURE_TURN_MAX,
  PICTURES_PER_SERIES,
  pictureTurn,
  QUIETEST_TRANSITION,
} from "./picture.js";

const PICTURE = "did:syr:z6Mk/01J";

const DID = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva";

const row = (appearance: unknown) => ({
  created_by: DID,
  address: "1a",
  depth: 2,
  origin: `${DID}/01JSPREAD00000000000000000`,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  appearance,
});

const CHANNELS: Record<string, unknown> = {
  ring_weight: "regular",
  ring_style: "regular",
  mark_radius: "regular",
  preview: PICTURE,
  preview_more: [`${PICTURE}b`],
  preview_every: 360,
  preview_transition: "regular",
  preview_size: "regular",
};

const UNSTYLED = {
  ringWeight: "none",
  ringStyle: "solid",
  markRadius: "regular",
  preview: {
    pictures: [],
    every: PICTURE_TURN_DEFAULT,
    transition: QUIETEST_TRANSITION,
  },
  previewSize: "small",
};

// The round trip is the contract rather than the vocabulary: a look an older
// build cannot draw survives being read and written back by it. Crossing to a
// peer is a separate thing and does not happen yet — DESIGN.md § "A note's look
// never uses colour". AI.md § "Provider-Agnostic Data Shapes".
describe("a look this build cannot draw", () => {
  const later = {
    ring_weight: "gossamer",
    ring_style: "double",
    mark_radius: "enormous",
    preview_size: "whole",
    preview_transition: "dissolve",
    preview: "p0",
    preview_more: Array.from({ length: 15 }, (_, at) => `p${at + 1}`),
    preview_every: PICTURE_TURN_MAX * 2,
  };

  it("is carried untouched rather than refused", () => {
    expect(NodeAppearanceSchema.parse(later)).toEqual(later);
  });

  // A channel that refused would take the whole row with it, and `appearance`
  // sits inside `NodeSchema`: a look Sloppy cannot draw costs that look and
  // never the note.
  it("leaves the note it is on readable", () => {
    const parsed = NodeSchema.omit({ id: true }).parse(row(later));
    expect(parsed.appearance).toEqual(later);
  });

  it("is drawn at the count and the cadence this build holds", () => {
    const look = resolveAppearance(later);
    expect(look.preview.pictures).toHaveLength(PICTURES_PER_SERIES);
    expect(look.preview.every).toBe(PICTURE_TURN_MAX);
  });

  it("draws as an unstyled note does, so nothing renders a token it cannot", () => {
    expect(
      resolveAppearance(
        NodeAppearanceSchema.parse({
          ring_style: "double",
          preview_size: "whole",
          preview_transition: "dissolve",
        }),
      ),
    ).toEqual(UNSTYLED);
  });

  it("resolves every value this build does draw to itself", () => {
    for (const ring_weight of RING_WEIGHTS) {
      expect(resolveAppearance({ ring_weight }).ringWeight).toBe(ring_weight);
    }
    for (const ring_style of RING_STYLES) {
      expect(resolveAppearance({ ring_style }).ringStyle).toBe(ring_style);
    }
    for (const mark_radius of MARK_RADII) {
      expect(resolveAppearance({ mark_radius }).markRadius).toBe(mark_radius);
    }
    for (const preview_size of PREVIEW_SIZES) {
      expect(resolveAppearance({ preview_size }).previewSize).toBe(
        preview_size,
      );
    }
    for (const preview_transition of PICTURE_TRANSITIONS) {
      expect(resolveAppearance({ preview_transition }).preview.transition).toBe(
        preview_transition,
      );
    }
  });
});

// The developer's ruling: a note's look never uses hue, because hue on the
// canvas is the reader's own question. DESIGN.md § "The mark".
describe("the channels a look may spend", () => {
  it("are shape and imagery, and colour is not among them at any level", () => {
    const parsed = NodeAppearanceSchema.parse({
      ring_weight: "heavy",
      color: "oklch(0.5 0.2 30)",
      fill: "#ff0000",
      ring: { color: "red" },
    });
    expect(Object.keys(parsed)).toEqual(["ring_weight"]);
    expect(JSON.stringify(parsed)).not.toMatch(/colou?r/i);
  });

  it("are the only keys the schema knows", () => {
    expect(Object.keys(NodeAppearanceSchema.parse(CHANNELS)).sort()).toEqual(
      Object.keys(CHANNELS).sort(),
    );
  });
});

// DESIGN.md § "A picture that takes turns". The mark spells a series across two
// stored channels so a row written before there could be several still parses;
// what a renderer reads is one list.
describe("the pictures a mark wears", () => {
  it("start at the one a row written before there could be several holds", () => {
    expect(resolveAppearance({ preview: PICTURE }).preview.pictures).toEqual([
      PICTURE,
    ]);
  });

  it("are that one and then the rest, in the order they take turns", () => {
    expect(
      resolveAppearance({ preview: "a", preview_more: ["b", "c"] }).preview
        .pictures,
    ).toEqual(["a", "b", "c"]);
  });

  it("are none where nothing starts the series, however many follow it", () => {
    expect(
      resolveAppearance({ preview_more: ["b", "c"] }).preview.pictures,
    ).toEqual([]);
  });

  it("are bounded where a look is written, and kept where one is read", () => {
    const more = Array.from(
      { length: PICTURES_PER_SERIES },
      (_, at) => `p${at}`,
    );
    expect(() =>
      WrittenAppearanceSchema.parse({ preview_more: more }),
    ).toThrow();
    expect(
      WrittenAppearanceSchema.parse({ preview_more: more.slice(1) })
        .preview_more,
    ).toHaveLength(PICTURES_PER_SERIES - 1);
    expect(NodeAppearanceSchema.parse({ preview_more: more })).toEqual({
      preview_more: more,
    });
  });

  it("hold the cadence a request asks for to the range one may take", () => {
    expect(() =>
      WrittenAppearanceSchema.parse({ preview_every: PICTURE_TURN_MAX + 1 }),
    ).toThrow();
    expect(
      WrittenAppearanceSchema.parse({ preview_every: PICTURE_TURN_MAX })
        .preview_every,
    ).toBe(PICTURE_TURN_MAX);
  });

  it("are spelt back across the two channels they are stored in", () => {
    for (let count = 0; count <= PICTURES_PER_SERIES; count += 1) {
      const pictures = Array.from({ length: count }, (_, at) => `p${at}`);
      expect(
        resolveAppearance(seriesChannels(pictures)).preview.pictures,
        `${count}`,
      ).toEqual(pictures);
    }
    expect(seriesChannels(["a", "b", "c"])).toEqual({
      preview: "a",
      preview_more: ["b", "c"],
    });
  });

  it("take their turns off the same clock the ground under them does", () => {
    const look = resolveAppearance({
      preview: "a",
      preview_more: ["b"],
      preview_every: 30,
    });
    expect(pictureTurn(look.preview, 0)).toBe("a");
    expect(pictureTurn(look.preview, 30 * 60_000)).toBe("b");
  });
});

describe("a note nobody styled", () => {
  it("parses without an appearance, so a row written before this one does too", () => {
    const { appearance: _, ...without } = row(undefined);
    const parsed = NodeSchema.omit({ id: true }).parse(without);
    expect(parsed.appearance).toBeUndefined();
    expect("appearance" in parsed).toBe(false);
  });

  it("draws as the graph's own language alone says", () => {
    expect(resolveAppearance(undefined)).toEqual(UNSTYLED);
  });

  it("is what an appearance with every channel taken back off is", () => {
    expect(isUnstyled(undefined)).toBe(true);
    expect(isUnstyled(null)).toBe(true);
    expect(isUnstyled(NodeAppearanceSchema.parse({}))).toBe(true);
    expect(isUnstyled(seriesChannels([]))).toBe(true);
    expect(isUnstyled({ preview_more: [] })).toBe(true);
    expect(isUnstyled({ ring_weight: "none" })).toBe(false);
    expect(isUnstyled({ preview_size: "large" })).toBe(false);
  });
});
