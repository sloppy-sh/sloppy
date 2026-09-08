// What is written beside a mark. A note is named by its address where it has
// one and by its title where it has none, so a mega-node's count has to follow
// whichever of the two named it.

import type { Address, NodeView, OwnedRef } from "@sloppy/types";
import { describe, expect, it, vi } from "vitest";
import type { DrawnNode } from "./contract.js";
import { buildModel } from "./model.js";
import { buildPalette } from "./palette.js";
import {
  FakeApplication,
  type FakeContainer,
  FakeText,
} from "./pixi.test-support.js";

vi.mock("pixi.js", async () => {
  const { fakePixi } = await import("./pixi.test-support.js");
  return fakePixi();
});

const { GraphScene, MAX_FIELDS } = await import("./scene.js");

const OWNER = "did:syr:someone";
const REF = `${OWNER}/01JCAPTION00000000000000AA` as OwnedRef;

const palette = buildPalette({
  ink: "#101010",
  paper: "#fdfdfd",
  hues: ["#4455cc"],
});

/** The words a lone mark is written with, the address face first. */
async function captionOf(mark: {
  address?: string;
  title: string;
  folded?: number;
}): Promise<string[]> {
  const node = {
    ref: REF,
    created_by: OWNER,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...(mark.address === undefined ? {} : { address: mark.address as Address }),
    depth: 1,
    origin: REF,
    title: mark.title,
    tags: [],
    links: [],
    published: false,
  } as NodeView;
  const folded = mark.folded ?? 0;
  const entry: DrawnNode = {
    node,
    collapsed: folded > 0,
    folded,
    tags: [],
  };

  const scene = await GraphScene.create({} as HTMLCanvasElement, {
    fonts: { ui: "ui", address: "mono" },
    palette,
    resolution: 2,
  });
  const app = FakeApplication.latest as FakeApplication;
  scene.setModel(buildModel([entry], { selection: [], palette }), false);
  scene.fit();
  app.tick();
  return writtenOn(app);
}

/** Every word standing beside a mark, in the order the slots hold them. */
function writtenOn(app: FakeApplication): string[] {
  const layer = app.stage.children.find((child: FakeContainer) =>
    child.children.some((kid) => kid instanceof FakeText),
  );
  if (!layer) throw new Error("The stage has no text on it");
  return layer.children
    .slice(0, -MAX_FIELDS)
    .filter((kid): kid is FakeText => kid instanceof FakeText && kid.visible)
    .map((kid) => kid.text)
    .filter((written) => written !== "");
}

describe("what is written beside a mark", () => {
  it("writes the address it has, and the title beside it", async () => {
    expect(await captionOf({ address: "1a", title: "Mushrooms" })).toEqual([
      "1a",
      "Mushrooms",
    ]);
  });

  it("writes the title alone for a note nobody numbered", async () => {
    expect(await captionOf({ title: "Mushrooms" })).toEqual(["Mushrooms"]);
  });

  it("counts a fold after the address that names it", async () => {
    expect(
      await captionOf({ address: "1a", title: "Mushrooms", folded: 12 }),
    ).toEqual(["1a +12", "Mushrooms"]);
  });

  // The count never lands ahead of the name: with no address it is the title
  // that names the mark, so the count follows the title instead.
  it("counts a fold after the title where that is the name", async () => {
    expect(await captionOf({ title: "Mushrooms", folded: 12 })).toEqual([
      "Mushrooms +12",
    ]);
  });

  // The count is part of the name, so it comes out of the same budget rather
  // than being added past the end of it.
  it("keeps a counted title inside the room an uncounted one gets", async () => {
    const long = "Mushrooms of the coastal temperate rainforest";
    const [counted] = await captionOf({ title: long, folded: 12 });
    const [plain] = await captionOf({ title: long });
    expect(counted.endsWith(" +12")).toBe(true);
    expect(counted.length).toBeLessThanOrEqual(plain.length);
  });

  it("writes the count alone for a fold with nothing naming it", async () => {
    expect(await captionOf({ title: "  ", folded: 12 })).toEqual(["+12"]);
  });

  it("writes nothing beside a note with neither", async () => {
    expect(await captionOf({ title: "" })).toEqual([]);
  });
});

const SECOND = `${OWNER}/01JCAPTION00000000000000AB` as OwnedRef;

function noteOf(mark: {
  ref: OwnedRef;
  address?: string;
  title: string;
  parent?: OwnedRef;
}): NodeView {
  return {
    ref: mark.ref,
    created_by: OWNER,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...(mark.address === undefined ? {} : { address: mark.address as Address }),
    ...(mark.parent === undefined ? {} : { parent: mark.parent }),
    depth: mark.parent === undefined ? 1 : 2,
    origin: mark.ref,
    title: mark.title,
    tags: [],
    links: [],
    published: false,
  } as NodeView;
}

const standing = (node: NodeView): DrawnNode => ({
  node,
  collapsed: false,
  folded: 0,
  tags: [],
});

async function canvasOf(drawn: readonly DrawnNode[]) {
  const scene = await GraphScene.create({} as HTMLCanvasElement, {
    fonts: { ui: "ui", address: "mono" },
    palette,
    resolution: 2,
  });
  const app = FakeApplication.latest as FakeApplication;
  scene.setModel(buildModel([...drawn], { selection: [], palette }), false);
  scene.fit();
  app.tick();
  return { scene, app };
}

// A slot is held per mark and rewriting one is the dearest thing a frame does,
// so a caption that moves under a mark already carrying its slot is exactly
// what a held slot can miss.
describe("a caption that moves while the canvas is up", () => {
  it("writes the address a mark is given without it leaving the canvas", async () => {
    const { scene, app } = await canvasOf([
      standing(noteOf({ ref: REF, title: "Mushrooms" })),
    ]);
    expect(writtenOn(app)).toEqual(["Mushrooms"]);

    scene.setTints(
      buildModel(
        [standing(noteOf({ ref: REF, address: "13", title: "Mushrooms" }))],
        { selection: [], palette },
      ),
      false,
    );
    app.tick();
    expect(writtenOn(app)).toEqual(["13", "Mushrooms"]);
  });

  it("takes an address off a mark, and follows a retitling", async () => {
    const { scene, app } = await canvasOf([
      standing(noteOf({ ref: REF, address: "13", title: "Mushrooms" })),
    ]);
    expect(writtenOn(app)).toEqual(["13", "Mushrooms"]);

    scene.setTints(
      buildModel(
        [standing(noteOf({ ref: REF, title: "Every index is a bet" }))],
        { selection: [], palette },
      ),
      false,
    );
    app.tick();
    expect(writtenOn(app)).toEqual(["Every index is a bet"]);
  });

  it("counts the fold on the mark that swallowed a subtree", async () => {
    const root = noteOf({ ref: REF, address: "1", title: "Mushrooms" });
    const under = noteOf({
      ref: SECOND,
      address: "1a",
      title: "Every index is a bet",
      parent: REF,
    });
    const { scene, app } = await canvasOf([standing(root), standing(under)]);
    expect(writtenOn(app).sort()).toEqual(
      ["1", "1a", "Every index is a bet", "Mushrooms"].sort(),
    );

    scene.setModel(
      buildModel([{ node: root, collapsed: true, folded: 1, tags: [] }], {
        selection: [],
        palette,
      }),
      false,
    );
    app.tick();
    expect(writtenOn(app).sort()).toEqual(["1 +1", "Mushrooms"].sort());
  });
});
