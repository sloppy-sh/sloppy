// Every piece of lettering the canvas draws — a graph's name over its field, a
// set's name inside its outline, a mark's caption beside it — is placed into one
// collision set, so no two of them overprint. DESIGN.md § "Sets — the tags as
// places" and § "The canvas".

import type { OwnedRef, Tag } from "@sloppy/types";
import { describe, expect, it, vi } from "vitest";
import type { DrawnNode, GraphField } from "./contract.js";
import { makeCorpus } from "./corpus.test-support.js";
import { buildModel } from "./model.js";
import { buildPalette } from "./palette.js";
import {
  FakeApplication,
  type FakeContainer,
  FakeText,
} from "./pixi.test-support.js";
import { shapeBounds } from "./sets/geometry.js";
import { packSets, SETS_STEP } from "./sets/pack.js";

vi.mock("pixi.js", async () => {
  const { fakePixi } = await import("./pixi.test-support.js");
  return fakePixi();
});

const { GraphScene } = await import("./scene.js");

const corpus = makeCorpus({ total: 600 });
const NOTEBOOKS = [
  { ulid: "01LETTERINGTHESIS000000000", title: "the thesis" },
  { ulid: "01LETTERINGGARDEN000000000", title: "the garden" },
] as const;

const palette = buildPalette(
  {
    ink: "#101010",
    paper: "#fdfdfd",
    hues: ["#4455cc", "#cc5544", "#44aa66", "#aa8822"],
  },
  0,
  corpus.tags.length,
);

/** The corpus as two notebooks side by side, so the field names are drawn too. */
const notebooks = corpus.nodes.map((node, at) => ({
  ...node,
  graph: `${node.created_by}/${NOTEBOOKS[at % 2].ulid}` as OwnedRef,
  notebook: NOTEBOOKS[at % 2].title,
}));

const fields: GraphField[] = [
  ...new Map(notebooks.map((node) => [node.graph, node.notebook] as const)),
].map(([ref, title]) => ({ ref, title }));

const drawn: DrawnNode[] = notebooks.map((node) => ({
  node,
  collapsed: false,
  folded: 0,
  tags: node.tags,
}));

function model(arrangement: "sets" | "genealogy", selection: readonly Tag[]) {
  if (arrangement === "genealogy") {
    return buildModel(drawn, { selection, palette, fields });
  }
  return buildModel(drawn, {
    arrangement: "sets",
    sets: packSets({
      notes: notebooks.map((node) => ({
        ref: node.ref,
        graph: node.graph as OwnedRef,
        tags: node.tags,
        created_at: node.created_at,
      })),
      fields: fields.map((field) => field.ref),
      selection,
      spacing: SETS_STEP,
      most: 400,
      gutter: 900,
    }),
    selection,
    palette,
    fields,
  });
}

async function canvasOn(
  arrangement: "sets" | "genealogy",
  selection: readonly Tag[],
) {
  const scene = await GraphScene.create({} as HTMLCanvasElement, {
    fonts: { ui: "ui", address: "mono" },
    palette,
    resolution: 2,
  });
  const app = FakeApplication.latest as FakeApplication;
  scene.setModel(model(arrangement, selection), arrangement === "sets");
  scene.fit();
  for (let frame = 0; frame < 8; frame++) {
    scene.invalidate();
    app.tick();
  }
  return { scene, app };
}

interface Lettering {
  words: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Every word shown on the canvas, as the box it fills. */
function lettering(app: FakeApplication): Lettering[] {
  const layer = app.stage.children.find((child) =>
    child.children.some((kid) => kid instanceof FakeText),
  ) as FakeContainer;
  return layer.children
    .filter(
      (kid): kid is FakeText =>
        kid instanceof FakeText && kid.visible && kid.text !== "",
    )
    .map((text) => ({
      words: text.text,
      minX: text.x - text.width * text.anchorX,
      minY: text.y - text.height * text.anchorY,
      maxX: text.x + text.width * (1 - text.anchorX),
      maxY: text.y + text.height * (1 - text.anchorY),
    }));
}

function overprints(shown: readonly Lettering[]): string[] {
  const over: string[] = [];
  for (const [at, one] of shown.entries()) {
    for (const other of shown.slice(at + 1)) {
      if (one.maxX <= other.minX || other.maxX <= one.minX) continue;
      if (one.maxY <= other.minY || other.maxY <= one.minY) continue;
      over.push(`${one.words} over ${other.words}`);
    }
  }
  return over;
}

/** The tags whose own outline reaches the screen, which are the ones a reader is
 *  owed a name for. */
function setsOnScreen(
  scene: Awaited<ReturnType<typeof GraphScene.create>>,
): Set<string> {
  const { sets } = model("sets", corpus.tags.slice(0, 3));
  const seen = new Set<string>();
  for (const field of sets?.fields ?? []) {
    for (const set of field.sets) {
      const box = shapeBounds(set.shape);
      const from = scene.viewport.toScreen(
        box.minX + field.dx,
        box.minY + field.dy,
      );
      const to = scene.viewport.toScreen(
        box.maxX + field.dx,
        box.maxY + field.dy,
      );
      if (to.x < 0 || from.x > 390 || to.y < 0 || from.y > 740) continue;
      seen.add(set.tag);
    }
  }
  return seen;
}

describe("the words on the canvas", () => {
  for (const [name, arrangement, tags] of [
    ["the sets with nothing selected", "sets", 3],
    ["the sets with two tags selected", "sets", 2],
    ["the genealogy over two fields", "genealogy", 0],
  ] as const) {
    it(`writes nothing over anything else on ${name}`, async () => {
      const selection = corpus.tags.slice(0, tags);
      const { scene, app } = await canvasOn(arrangement, selection);

      expect(lettering(app).length).toBeGreaterThan(1);
      for (const step of [1, 2, 4, 8, 16]) {
        scene.viewport.zoomAt(195, 370, step === 1 ? 1 : 2);
        scene.centreOn(drawn[0].node.ref);
        for (let frame = 0; frame < 4; frame++) {
          scene.invalidate();
          app.tick();
        }
        expect(
          overprints(lettering(app)),
          `at ${step}x the view it was framed at`,
        ).toEqual([]);
      }
      scene.destroy();
    });
  }

  // A caption gives way; a set's name moves instead, because it is the only
  // thing on the canvas that says in words which place is which tag.
  it("names every set that reaches the screen", async () => {
    const selection = corpus.tags.slice(0, 3);
    const { scene, app } = await canvasOn("sets", selection);

    for (const step of [1, 2, 4, 8]) {
      scene.viewport.zoomAt(195, 370, step === 1 ? 1 : 2);
      scene.centreOn(drawn[0].node.ref);
      for (let frame = 0; frame < 4; frame++) {
        scene.invalidate();
        app.tick();
      }
      const said = new Set(lettering(app).map((one) => one.words));
      for (const tag of setsOnScreen(scene)) {
        expect(said, `${tag} at ${step}x`).toContain(tag);
      }
    }
    scene.destroy();
  });
});
