// DESIGN.md § "Sets — the tags as places": the regions are a wash on the paper
// under the marks, and nothing else about the canvas changes. What is checked
// here is what the scene ASKED to have drawn — the figure itself is a GPU fact
// and `bench/` is where it is looked at.

import type { DidSyr, NodeView, OwnedRef, Tag } from "@sloppy/types";
import { MARK_SCALE_MAX } from "@sloppy/types";
import { describe, expect, it, vi } from "vitest";
import { DRAWN_SETS_MOST, type DrawnNode } from "./contract.js";
import { buildModel, LEAF_RADIUS, MAX_RADIUS } from "./model.js";
import { buildPalette } from "./palette.js";
import {
  FakeApplication,
  type FakeContainer,
  FakeGraphics,
  FakeText,
  worldOf,
} from "./pixi.test-support.js";
import {
  membershipOf,
  packSets,
  SETS_STEP,
  type SetsStanding,
} from "./sets/pack.js";

vi.mock("pixi.js", async () => {
  const { fakePixi } = await import("./pixi.test-support.js");
  return fakePixi();
});

const { GraphScene, LABEL_LINE, MAX_FIELDS } = await import("./scene.js");

const OWNER = "did:syr:someone";
const TAGS = ["biology", "seed"] as Tag[];
const tokens = {
  ink: "#101010",
  paper: "#fdfdfd",
  hues: ["#4455cc", "#cc5544", "#44aa66", "#aa8822"],
};
const palette = buildPalette(tokens, 0, TAGS.length);

const refOf = (serial: number): OwnedRef =>
  `${OWNER}/${serial.toString(36).padStart(26, "0")}` as OwnedRef;

function drawn(serial: number, tags: Tag[]): DrawnNode {
  const ref = refOf(serial);
  return {
    node: {
      ref,
      created_by: OWNER,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      address: `1a${serial + 1}`,
      depth: 2,
      origin: ref,
      title: `note ${serial}`,
      tags: [...tags],
      links: [],
      published: false,
    } as NodeView,
    collapsed: false,
    folded: 0,
    tags,
  };
}

/** A field with something standing in each of the four regions. */
const field: DrawnNode[] = [
  ...Array.from({ length: 4 }, (_unused, at) => drawn(at, [])),
  ...Array.from({ length: 4 }, (_unused, at) => drawn(10 + at, [TAGS[0]])),
  ...Array.from({ length: 4 }, (_unused, at) => drawn(20 + at, [TAGS[1]])),
  ...Array.from({ length: 4 }, (_unused, at) => drawn(30 + at, [...TAGS])),
];

function sets(selection: readonly Tag[] = TAGS) {
  return buildModel(field, {
    arrangement: "sets",
    sets: packSets({
      notes: field.map((entry) => ({
        ref: entry.node.ref,
        graph: OWNER as OwnedRef,
        tags: entry.tags,
        created_at: entry.node.created_at,
      })),
      fields: [],
      selection,
      spacing: SETS_STEP,
      most: 400,
      gutter: 900,
    }),
    selection,
    palette,
  });
}

async function canvas() {
  const scene = await GraphScene.create({} as HTMLCanvasElement, {
    fonts: { ui: "ui", address: "mono" },
    palette,
    resolution: 2,
  });
  const app = FakeApplication.latest as FakeApplication;
  scene.setModel(sets(), true);
  scene.fit();
  for (let frame = 0; frame < field.length; frame++) {
    scene.invalidate();
    app.tick();
  }
  return { scene, app };
}

/** The layers the world holds, in the order `scene.ts` adds them. */
function layers(app: FakeApplication): FakeGraphics[] {
  return worldOf(app).children.filter(
    (child): child is FakeGraphics => child instanceof FakeGraphics,
  );
}

/** Every word on the canvas that is actually shown. */
function words(app: FakeApplication): string[] {
  const said = (of: FakeContainer): string[] =>
    of.children.flatMap((child) =>
      child instanceof FakeText
        ? child.visible && child.text !== ""
          ? [child.text]
          : []
        : said(child),
    );
  return said(app.stage);
}

describe("the drawn sets as places on the paper", () => {
  it("washes one region per drawn tag, under everything else", async () => {
    const { scene, app } = await canvas();
    const [regions] = layers(app);

    expect(regions.paths).toHaveLength(TAGS.length);
    expect(regions.paths.map((path) => path.color)).toEqual([
      palette.setsFill(1),
      palette.setsFill(2),
    ]);
    for (const path of regions.paths) {
      expect(path.alpha).toBeCloseTo(palette.setsWash, 12);
      expect(path.points.length).toBeGreaterThan(8);
    }
    scene.destroy();
  });

  // The wash owes no floor; the hairline does, so it takes the colour a mark of
  // that slot takes rather than the wash's own.
  it("runs a hairline round each one in the colour a mark takes", async () => {
    const { scene, app } = await canvas();
    const [regions] = layers(app);
    const struck = new Set(regions.lines.map((line) => line.color));

    expect(struck).toEqual(new Set([palette.tag(1), palette.tag(2)]));
    for (const line of regions.lines) {
      expect(line.alpha).toBeLessThan(1);
      expect(line.width).toBeGreaterThan(0);
    }
    scene.destroy();
  });

  it("names each set where the figure is framed", async () => {
    const { scene, app } = await canvas();
    for (const tag of TAGS) expect(words(app)).toContain(tag);
    scene.destroy();
  });

  /** The texts the canvas keeps for the set names, and the ones it keeps for
   *  everything else written on the marks. */
  function written(app: FakeApplication) {
    const layer = app.stage.children.find((child) =>
      child.children.some((kid) => kid instanceof FakeText),
    ) as FakeContainer;
    const shown = (of: readonly FakeContainer[]) =>
      of.filter(
        (kid): kid is FakeText =>
          kid instanceof FakeText && kid.visible && kid.text !== "",
      );
    const names = DRAWN_SETS_MOST * MAX_FIELDS;
    return {
      names: shown(layer.children.slice(0, names)),
      captions: shown(layer.children.slice(names, -MAX_FIELDS)),
    };
  }

  /** Inside one lens, with most of both sets off the screen. */
  async function zoomedIn() {
    const { scene, app } = await canvas();
    const model = sets();
    const inside = model.order.find(
      (ref) => model.sets?.standing.get(ref)?.region === 0b11,
    ) as string;
    scene.viewport.lookAt({ x: 0, y: 0, scale: 1 });
    scene.centreOn(inside);
    for (let frame = 0; frame < field.length; frame++) {
      scene.invalidate();
      app.tick();
    }
    return { scene, app };
  }

  // A reader zoomed into a lens is still owed which sets they are standing in,
  // so a name is held inside its own set and inside the screen.
  it("holds each name on the screen while its set runs off it", async () => {
    const { scene, app } = await zoomedIn();
    const { names } = written(app);

    expect(names.map((text) => text.text).sort()).toEqual([...TAGS].sort());
    for (const text of names) {
      expect(text.x).toBeGreaterThanOrEqual(0);
      expect(text.x).toBeLessThanOrEqual(390);
      expect(text.y).toBeGreaterThanOrEqual(0);
      expect(text.y).toBeLessThanOrEqual(740);
    }
    scene.destroy();
  });

  // The name is the only thing on the canvas saying in words which place is
  // which tag, so a mark's caption gives way to it rather than over it.
  it("writes nothing over a name", async () => {
    const { scene, app } = await zoomedIn();
    const { names, captions } = written(app);

    expect(captions.length).toBeGreaterThan(0);
    for (const name of names) {
      for (const caption of captions) {
        if (Math.abs(caption.y - name.y) >= LABEL_LINE) continue;
        const over =
          caption.x < name.x + name.width / 2 &&
          name.x - name.width / 2 < caption.x + caption.width;
        expect(over, `${caption.text} over ${name.text}`).toBe(false);
      }
    }
    scene.destroy();
  });

  // A mark's own caption is drawn exactly as it is in the genealogy, so the
  // marks have to be big enough on screen to carry one — which is what the
  // framed figure is not.
  it("keeps a mark's caption beside it", async () => {
    const { scene, app } = await canvas();
    const ref = sets().order[0];
    scene.viewport.zoomAt(0, 0, 1 / scene.viewport.scale);
    scene.centreOn(ref);
    for (let frame = 0; frame < field.length; frame++) {
      scene.invalidate();
      app.tick();
    }

    expect(
      words(app).filter((one) => one.startsWith("1a")).length,
    ).toBeGreaterThan(0);
    scene.destroy();
  });

  it("draws no line between the marks", async () => {
    const { scene, app } = await canvas();
    const [, , genealogy, runs, connections] = layers(app);

    expect(genealogy.lines).toEqual([]);
    expect(runs.lines).toEqual([]);
    expect(connections.lines).toEqual([]);
    scene.destroy();
  });

  it("lights the region a held mark is over, and lets it go", async () => {
    const { scene, app } = await canvas();
    const [regions] = layers(app);
    const both: SetsStanding = { field: 0, region: 0b11 };

    scene.setSetsDrop(both);
    app.tick();
    expect(regions.rects.length).toBeGreaterThan(0);
    for (const box of regions.rects) {
      expect(box.color).toBe(palette.ink);
      expect(box.alpha).toBeCloseTo(palette.setsLit, 12);
    }

    scene.setSetsDrop(null);
    app.tick();
    expect(regions.rects).toEqual([]);
    scene.destroy();
  });

  it("frames a region for the fold that stands for it, and nothing else", async () => {
    const scene = await GraphScene.create({} as HTMLCanvasElement, {
      fonts: { ui: "ui", address: "mono" },
      palette,
      resolution: 2,
    });
    // Too little room to stand them in, so each region folds to one mark.
    const model = buildModel(field, {
      arrangement: "sets",
      sets: packSets({
        notes: field.map((entry) => ({
          ref: entry.node.ref,
          graph: OWNER as OwnedRef,
          tags: entry.tags,
          created_at: entry.node.created_at,
        })),
        fields: [],
        selection: TAGS,
        spacing: SETS_STEP,
        most: 2,
        gutter: 900,
      }),
      selection: TAGS,
      palette,
    });
    scene.setModel(model, true);
    const fold = [...(model.sets?.folds.keys() ?? [])][0];
    const standing = model.order.find((ref) => !model.sets?.folds.has(ref));

    const looking = () => {
      const { x, y, scale } = scene.viewport;
      return { x, y, scale };
    };
    const before = looking();
    expect(scene.frameRegion(fold)).toBe(true);
    expect(looking()).not.toEqual(before);
    if (standing !== undefined) {
      expect(scene.frameRegion(standing)).toBe(false);
    }
    scene.destroy();
  });

  it("washes nothing where the host asked for the genealogy", async () => {
    const scene = await GraphScene.create({} as HTMLCanvasElement, {
      fonts: { ui: "ui", address: "mono" },
      palette,
      resolution: 2,
    });
    const app = FakeApplication.latest as FakeApplication;
    scene.setModel(buildModel(field, { selection: TAGS, palette }), true);
    app.tick();

    const [regions] = layers(app);
    expect(regions.paths).toEqual([]);
    expect(regions.rects).toEqual([]);
    expect(words(app)).not.toContain(TAGS[0]);
    scene.destroy();
  });
});

// DESIGN.md § "Sets — the tags as places": a fold over a region is not a note
// and no surface treats it as one. The note whose ref names the mark is picked
// by where it sorts in the region, so anything of that note the fold wore would
// be the graph saying something about hundreds of notes that is true of one.
describe("the fold over a crowded region", () => {
  const PEER = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva";
  /** The note sorting first in the region of `TAGS[0]`, and the one sorting
   *  first outside every region. */
  const NAMING = 10;
  const NAMING_THE_REST = 0;

  /** The same field, with the two notes a fold would name dressed in everything
   *  a mark carries of its author, and the graph's own word over them. */
  const dressed: DrawnNode[] = field.map((entry) =>
    entry.node.ref === refOf(NAMING)
      ? {
          ...entry,
          node: {
            ...entry.node,
            created_by: PEER,
            published: true,
            appearance: {
              ring_weight: "heavy",
              ring_style: "dashed",
              mark_radius: "giant",
              preview: "upload-1",
            },
          } as NodeView,
        }
      : entry.node.ref === refOf(NAMING_THE_REST)
        ? { ...entry, node: { ...entry.node, depth: 5 } as NodeView }
        : entry,
  );

  /** `most` is what crowds the regions: 2 leaves no region room for its four. */
  function model(entries: readonly DrawnNode[], most: number) {
    return buildModel(entries, {
      arrangement: "sets",
      sets: packSets({
        notes: entries.map((entry) => ({
          ref: entry.node.ref,
          graph: OWNER as OwnedRef,
          tags: entry.tags,
          created_at: entry.node.created_at,
        })),
        fields: [],
        selection: TAGS,
        spacing: SETS_STEP,
        most,
        gutter: 900,
      }),
      selection: TAGS,
      palette,
      viewer: OWNER as DidSyr,
      codeMoved: new Set([refOf(NAMING)]),
    });
  }

  /** The mark standing for one region, which where it folded is its fold. */
  function markIn(built: ReturnType<typeof model>, region: number) {
    const ref = built.order.find(
      (one) => built.sets?.standing.get(one)?.region === region,
    );
    expect(ref).toBeDefined();
    return built.graph.getNodeAttributes(ref as OwnedRef);
  }

  it("carries every channel the note it names set while it stands alone", () => {
    const mark = markIn(model(dressed, 400), 0b01);

    expect(mark.folded).toBe(0);
    expect(mark.provenance).toBe("pulled");
    expect(mark.ringWeight).toBe("heavy");
    expect(mark.ringStyle).toBe("dashed");
    expect(mark.preview.pictures).toEqual(["upload-1"]);
    expect(mark.codeMoved).toBe(true);
    expect(mark.radius).toBe(LEAF_RADIUS * MARK_SCALE_MAX);
  });

  it("wears none of them once it answers for the whole region", () => {
    const fold = markIn(model(dressed, 2), 0b01);

    expect(fold.folded).toBe(4);
    expect(fold.ringWeight).toBe("none");
    expect(fold.preview.pictures).toEqual([]);
    expect(fold.codeMoved).toBe(false);
    expect(fold.title).toBe("");
    expect(fold.address).toBeUndefined();
  });

  // The count is what a fold says, so a size that also said whose note sorted
  // first would stop the size being readable as the count.
  it("is sized by its count alone, whatever the note it names is sized at", () => {
    const built = model(dressed, 2);
    const dressedFold = markIn(built, 0b01);
    const plainFold = markIn(built, 0b10);

    expect(dressedFold.folded).toBe(plainFold.folded);
    expect(dressedFold.radius).toBe(plainFold.radius);
    expect(dressedFold.radius).toBeLessThan(MAX_RADIUS);
  });

  // PRODUCT.md principle 4: a pulled note is never taken for one of yours, and
  // a fold is the one mark that stands for several notes at once. So the
  // provenance of the notes standing there is the one thing of theirs it draws.
  describe("the provenance it draws", () => {
    /** The same field, with everything standing in `region` written by a peer
     *  — or published by its own author, where `published` says so. */
    const written = (
      region: number,
      by: { created_by?: string; published?: boolean },
    ): DrawnNode[] =>
      field.map((entry) =>
        membershipOf(entry.tags, TAGS) === region
          ? { ...entry, node: { ...entry.node, ...by } as NodeView }
          : entry,
      );

    /** The mark standing for a region, where it is one the notes folded into. */
    const foldIn = (built: ReturnType<typeof model>, region: number) => {
      const fold = markIn(built, region);
      expect(fold.folded).toBeGreaterThan(0);
      return fold;
    };

    it("folds a region of pulled notes pulled", () => {
      const built = model(written(0b10, { created_by: PEER }), 2);
      expect(foldIn(built, 0b10).provenance).toBe("pulled");
    });

    it("folds a region pulled where any note standing there is", () => {
      expect(foldIn(model(dressed, 2), 0b01).provenance).toBe("pulled");
    });

    it("folds a region of your own notes own", () => {
      expect(foldIn(model(dressed, 2), 0b11).provenance).toBe("own");
    });

    it("folds a region everybody can read as what they all are", () => {
      const built = model(written(0b10, { published: true }), 2);
      expect(foldIn(built, 0b10).provenance).toBe("published");
    });
  });

  // The rest stands in no region, so no selected tag answers for its fold and
  // the fill falls to the ramp — which is a fact about the ramp, not about
  // whichever note the region happens to name.
  it("draws the rest at no generation of one note's", () => {
    const fold = markIn(model(dressed, 2), 0);

    expect(fold.tag).toBeUndefined();
    expect(fold.depth).toBe(1);
    expect(fold.fill).toBe(palette.depth(1));
    expect(fold.fill).not.toBe(palette.depth(5));
  });
});
