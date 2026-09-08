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

  const layer = app.stage.children.find((child: FakeContainer) =>
    child.children.some((kid) => kid instanceof FakeText),
  );
  if (!layer) throw new Error("The stage has no text on it");
  return layer.children
    .slice(0, -MAX_FIELDS)
    .filter((kid): kid is FakeText => kid instanceof FakeText && kid.visible)
    .map((kid) => kid.text);
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

  it("writes the count alone for a fold with nothing naming it", async () => {
    expect(await captionOf({ title: "  ", folded: 12 })).toEqual(["+12"]);
  });

  it("writes nothing beside a note with neither", async () => {
    expect(await captionOf({ title: "" })).toEqual([]);
  });
});
