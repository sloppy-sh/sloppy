import { describe, expect, it } from "vitest";
import {
  isUnstyled,
  MARK_RADII,
  MARK_RADIUS_SCALE,
  MARK_SCALE_MAX,
  MARK_SCALE_MIN,
  NodeAppearanceSchema,
  PREVIEW_COVER_MAX,
  PREVIEW_COVER_MIN,
  PREVIEW_SIZE_COVER,
  PREVIEW_SIZES,
  RING_STYLES,
  RING_WEIGHTS,
  resolveAppearance,
  seriesChannels,
  seriesIsWhole,
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
  mark_scale: 1.5,
  preview: PICTURE,
  preview_more: [`${PICTURE}b`],
  preview_every: 360,
  preview_transition: "regular",
  preview_size: "regular",
  preview_cover: 0.5,
};

const UNSTYLED = {
  ringWeight: "none",
  ringStyle: "solid",
  markScale: 1,
  preview: {
    pictures: [],
    every: PICTURE_TURN_DEFAULT,
    transition: QUIETEST_TRANSITION,
  },
  previewCover: PREVIEW_COVER_MIN,
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
    mark_scale: 6,
    preview_size: "whole",
    preview_cover: 1,
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

  // A number is bounded rather than fallen back from: what a later Sloppy
  // widened past is drawn at the widest this one has, which is nearer what its
  // author asked for than a mark with nothing set.
  it("is drawn at the size and the cover this build reaches", () => {
    const look = resolveAppearance(later);
    expect(look.markScale).toBe(MARK_SCALE_MAX);
    expect(look.previewCover).toBe(PREVIEW_COVER_MAX);

    const narrow = resolveAppearance({ mark_scale: 0.01, preview_cover: 0.01 });
    expect(narrow.markScale).toBe(MARK_SCALE_MIN);
    expect(narrow.previewCover).toBe(PREVIEW_COVER_MIN);
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
      expect(resolveAppearance({ mark_radius }).markScale).toBe(
        MARK_RADIUS_SCALE[mark_radius],
      );
    }
    for (const preview_size of PREVIEW_SIZES) {
      expect(resolveAppearance({ preview_size }).previewCover).toBe(
        PREVIEW_SIZE_COVER[preview_size],
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

// DESIGN.md § "The mark": size and cover are one channel each, and the steps are
// the coarse way of saying what a number says exactly.
describe("a size and a cover an author dragged to", () => {
  it("is what the mark is drawn at, over the step beside it", () => {
    const both = resolveAppearance({
      mark_radius: "giant",
      mark_scale: 1.11,
      preview_size: "large",
      preview_cover: 0.55,
    });
    expect(both.markScale).toBe(1.11);
    expect(both.previewCover).toBe(0.55);
  });

  it("falls back to the step where an author dragged nothing", () => {
    expect(resolveAppearance({ mark_radius: "huge" }).markScale).toBe(
      MARK_RADIUS_SCALE.huge,
    );
    expect(resolveAppearance({ preview_size: "medium" }).previewCover).toBe(
      PREVIEW_SIZE_COVER.medium,
    );
  });

  // Every note already spelt in the steps keeps the mark it has, so what each
  // step is worth cannot move — and the ends of the range are the ladder's own.
  it("is worth for each step exactly what that step has always drawn", () => {
    expect(MARK_RADIUS_SCALE).toEqual({
      small: 0.78,
      regular: 1,
      large: 1.34,
      huge: 1.8,
      giant: 2.4,
    });
    expect(PREVIEW_SIZE_COVER).toEqual({
      small: 0.42,
      medium: 0.49,
      large: 0.6,
    });
    for (const [ladder, min, max] of [
      [MARK_RADIUS_SCALE, MARK_SCALE_MIN, MARK_SCALE_MAX],
      [PREVIEW_SIZE_COVER, PREVIEW_COVER_MIN, PREVIEW_COVER_MAX],
    ] as const) {
      for (const [step, worth] of Object.entries(ladder)) {
        expect(worth, step).toBeGreaterThanOrEqual(min);
        expect(worth, step).toBeLessThanOrEqual(max);
      }
    }
  });

  // A picture can be dragged over the whole face of the mark, which is more
  // than any step ever reached.
  it("reaches further than the largest step a picture could be spelt in", () => {
    expect(PREVIEW_COVER_MAX).toBeGreaterThan(PREVIEW_SIZE_COVER.large);
  });

  it("is held where a look is written to the range a mark draws", () => {
    for (const channel of ["mark_scale", "preview_cover"] as const) {
      const range =
        channel === "mark_scale"
          ? [MARK_SCALE_MIN, MARK_SCALE_MAX]
          : [PREVIEW_COVER_MIN, PREVIEW_COVER_MAX];
      for (const [at, edge] of range.entries()) {
        expect(
          WrittenAppearanceSchema.safeParse({ [channel]: edge }).success,
          `${channel} at ${edge}`,
        ).toBe(true);
        const past = at === 0 ? edge - 0.01 : edge + 0.01;
        expect(
          WrittenAppearanceSchema.safeParse({ [channel]: past }).success,
          `${channel} past ${edge}`,
        ).toBe(false);
      }
      // The stored shape keeps what a request may not send.
      expect(NodeAppearanceSchema.safeParse({ [channel]: 99 }).success).toBe(
        true,
      );
    }
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

  // The two channels can be written apart, and a surface that writes only the
  // second one loses every picture behind the first without failing anything.
  it("are recognised as lost where nothing starts the series", () => {
    expect(seriesIsWhole({ preview_more: ["b", "c"] })).toBe(false);
    expect(seriesIsWhole({ preview: "a", preview_more: ["b"] })).toBe(true);
    expect(seriesIsWhole({ preview_more: [] })).toBe(true);
    expect(seriesIsWhole({ mark_radius: "giant" })).toBe(true);
    expect(seriesIsWhole(null)).toBe(true);
    for (let count = 0; count <= PICTURES_PER_SERIES; count += 1) {
      const pictures = Array.from({ length: count }, (_, at) => `p${at}`);
      expect(seriesIsWhole(seriesChannels(pictures)), `${count}`).toBe(true);
    }
  });

  // AI.md: a refinement makes `.omit()` and `.partial()` throw at module
  // evaluation, which no build catches — and the surfaces that build a look
  // reshape this schema.
  it("leave the write contract a schema a form can still reshape", () => {
    expect(() => WrittenAppearanceSchema.partial()).not.toThrow();
    expect(() =>
      WrittenAppearanceSchema.omit({ preview_more: true }),
    ).not.toThrow();
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
