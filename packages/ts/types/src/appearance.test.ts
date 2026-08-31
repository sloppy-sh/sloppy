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

const CHANNELS = [
  "ring_weight",
  "ring_style",
  "mark_radius",
  "preview",
  "preview_size",
];

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
    };
    expect(NodeAppearanceSchema.parse(later)).toEqual(later);
  });

  it("draws as an unstyled note does, so nothing renders a token it cannot", () => {
    expect(
      resolveAppearance(
        NodeAppearanceSchema.parse({
          ring_style: "double",
          preview_size: "whole",
        }),
      ),
    ).toEqual({
      ringWeight: "none",
      ringStyle: "solid",
      markRadius: "regular",
      preview: undefined,
      previewSize: "small",
    });
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
    const every = Object.fromEntries(
      CHANNELS.map((channel) => [
        channel,
        channel === "preview" ? "did:syr:z6Mk/01J" : "regular",
      ]),
    );
    expect(Object.keys(NodeAppearanceSchema.parse(every)).sort()).toEqual(
      [...CHANNELS].sort(),
    );
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
    expect(resolveAppearance(undefined)).toEqual({
      ringWeight: "none",
      ringStyle: "solid",
      markRadius: "regular",
      preview: undefined,
      previewSize: "small",
    });
  });

  it("is what an appearance with every channel taken back off is", () => {
    expect(isUnstyled(undefined)).toBe(true);
    expect(isUnstyled(null)).toBe(true);
    expect(isUnstyled(NodeAppearanceSchema.parse({}))).toBe(true);
    expect(isUnstyled({ ring_weight: "none" })).toBe(false);
    expect(isUnstyled({ preview_size: "large" })).toBe(false);
  });
});
