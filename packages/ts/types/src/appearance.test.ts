import { describe, expect, it } from "vitest";
import {
  isUnstyled,
  MARK_RADII,
  NodeAppearanceSchema,
  PREVIEW_SIZES,
  RING_STYLES,
  RING_WEIGHTS,
  resolveAppearance,
} from "./appearance.js";
import { NodeSchema } from "./node.js";
import {
  PICTURE_TRANSITIONS,
  PICTURE_TURN_DEFAULT,
  PICTURES_PER_SERIES,
  pictureTurn,
  QUIETEST_TRANSITION,
} from "./picture.js";

const PICTURE = "did:syr:z6Mk/01J";

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
  it("is carried untouched rather than refused", () => {
    const later = {
      ring_weight: "gossamer",
      ring_style: "double",
      mark_radius: "enormous",
      preview_size: "whole",
      preview_transition: "dissolve",
    };
    expect(NodeAppearanceSchema.parse(later)).toEqual(later);
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

  it("are bounded, so a mark cannot be handed a library to wear", () => {
    const more = Array.from(
      { length: PICTURES_PER_SERIES },
      (_, at) => `p${at}`,
    );
    expect(() => NodeAppearanceSchema.parse({ preview_more: more })).toThrow();
    expect(
      NodeAppearanceSchema.parse({ preview_more: more.slice(1) }).preview_more,
    ).toHaveLength(PICTURES_PER_SERIES - 1);
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
    const did = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva";
    const row = {
      created_by: did,
      address: "1a",
      depth: 2,
      origin: `${did}/01JSPREAD00000000000000000`,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    const parsed = NodeSchema.omit({ id: true }).parse(row);
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
    expect(isUnstyled({ ring_weight: "none" })).toBe(false);
    expect(isUnstyled({ preview_size: "large" })).toBe(false);
  });
});
