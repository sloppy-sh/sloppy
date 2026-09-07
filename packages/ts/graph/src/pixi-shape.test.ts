// The one suite that loads the real pixi. Everywhere else `pixi.test-support.ts`
// stands in for it, so nothing else in the package would notice the library
// moving the calls `scene.ts` and `ground-layer.ts` make; this holds those calls
// against the shipped classes. It draws nothing and needs no GPU.

import * as pixi from "pixi.js";
import { describe, expect, it } from "vitest";

describe("Texture", () => {
  it("is made from a source and cut into by frame", () => {
    expect(typeof pixi.Texture.from).toBe("function");
    expect(pixi.Texture.WHITE).toBeInstanceOf(pixi.Texture);
    expect(pixi.Texture.WHITE.source).toBeDefined();

    const cut = new pixi.Texture({
      source: pixi.Texture.WHITE.source,
      frame: new pixi.Rectangle(3, 4, 5, 6),
    });

    expect([
      cut.frame.x,
      cut.frame.y,
      cut.frame.width,
      cut.frame.height,
    ]).toEqual([3, 4, 5, 6]);
    expect(typeof cut.destroy).toBe("function");
  });
});

describe("Container", () => {
  it("takes children in the order the layers are stacked", () => {
    const parent = new pixi.Container();
    const under = new pixi.Container();
    const over = new pixi.Container();
    const ground = new pixi.Container();

    parent.addChild(under, over);
    parent.addChildAt(ground, 0);

    expect([...parent.children]).toStrictEqual([ground, under, over]);

    parent.removeChild(under);
    expect([...parent.children]).toStrictEqual([ground, over]);

    const removed = parent.removeChildren();
    expect(removed).toHaveLength(2);
    expect(removed).toContain(ground);
    expect(removed).toContain(over);
    expect(parent.children).toHaveLength(0);
  });

  it("is moved and scaled through position and scale", () => {
    const container = new pixi.Container();

    container.position.set(12, -34);
    container.scale.set(2);
    container.eventMode = "none";

    expect([container.x, container.y]).toEqual([12, -34]);
    expect([container.scale.x, container.scale.y]).toEqual([2, 2]);
    expect(container.eventMode).toBe("none");
    expect(typeof container.destroy).toBe("function");
  });
});

describe("Graphics", () => {
  it("chains the calls a ring, an edge and a dash are drawn with", () => {
    const graphics = new pixi.Graphics();

    expect(graphics).toBeInstanceOf(pixi.Container);
    expect(graphics.clear()).toBe(graphics);
    expect(graphics.circle(1, 2, 3)).toBe(graphics);
    expect(graphics.stroke({ color: 0x112233, alpha: 0.5, width: 2 })).toBe(
      graphics,
    );
    expect(graphics.arc(1, 2, 3, 0, 1)).toBe(graphics);
    expect(graphics.fill(0x445566)).toBe(graphics);
    expect(graphics.moveTo(0, 0)).toBe(graphics);
    expect(graphics.lineTo(4, 5)).toBe(graphics);
  });
});

describe("particles", () => {
  it("holds marks in particleChildren and is told when they change", () => {
    const marks = new pixi.ParticleContainer({
      dynamicProperties: {
        position: true,
        scale: true,
        rotation: false,
        color: true,
      },
    });
    const mark = new pixi.Particle({
      texture: pixi.Texture.WHITE,
      anchorX: 0.5,
      anchorY: 0.25,
      scaleX: 2,
      scaleY: 3,
      tint: 0x112233,
      alpha: 0.5,
    });

    expect(marks).toBeInstanceOf(pixi.Container);
    expect(mark.texture).toBe(pixi.Texture.WHITE);
    expect([mark.anchorX, mark.anchorY]).toEqual([0.5, 0.25]);
    expect([mark.scaleX, mark.scaleY]).toEqual([2, 3]);
    expect(mark.tint).toBe(0x112233);
    expect(mark.alpha).toBe(0.5);

    marks.particleChildren.push(mark);
    marks.update();

    expect(marks.particleChildren).toEqual([mark]);
  });
});

describe("Sprite and TilingSprite", () => {
  it("carries a picture on an anchor", () => {
    const sprite = new pixi.Sprite(pixi.Texture.WHITE);

    sprite.anchor.set(0.5);
    sprite.visible = false;

    expect(sprite).toBeInstanceOf(pixi.Container);
    expect(sprite.texture).toBe(pixi.Texture.WHITE);
    expect([sprite.anchor.x, sprite.anchor.y]).toEqual([0.5, 0.5]);
    expect(sprite.visible).toBe(false);
    expect(typeof sprite.destroy).toBe("function");
  });

  it("tiles the ground by offset and step", () => {
    const tiling = new pixi.TilingSprite({ texture: pixi.Texture.WHITE });

    tiling.tilePosition.set(7, 8);
    tiling.tileScale.set(2, 3);
    tiling.tint = 0x010203;

    expect(tiling).toBeInstanceOf(pixi.Container);
    expect(tiling.texture).toBe(pixi.Texture.WHITE);
    expect([tiling.tilePosition.x, tiling.tilePosition.y]).toEqual([7, 8]);
    expect([tiling.tileScale.x, tiling.tileScale.y]).toEqual([2, 3]);
    expect(tiling.tint).toBe(0x010203);
  });
});

describe("Text", () => {
  it("takes a face and a resolution, and has the width a label is laid out by", () => {
    const text = new pixi.Text({
      text: "1a1",
      style: { fontFamily: "JetBrains Mono", fontSize: 12, fill: 0xffffff },
      resolution: 2,
    });

    text.anchor.set(0, 0.5);
    text.visible = false;
    text.alpha = 0.6;
    text.tint = 0x102030;

    expect(text).toBeInstanceOf(pixi.Container);
    expect(text.text).toBe("1a1");
    expect([text.anchor.x, text.anchor.y]).toEqual([0, 0.5]);
    expect(text.visible).toBe(false);
    expect(text.alpha).toBe(0.6);
    expect(text.tint).toBe(0x102030);
    // Reading it measures the glyphs against a canvas this suite has not got.
    expect("width" in text).toBe(true);
  });
});

describe("Application", () => {
  it("is started and stopped, and hands over a stage, a ticker and a renderer", () => {
    const app = new pixi.Application();

    expect(typeof app.init).toBe("function");
    expect(typeof app.destroy).toBe("function");
    expect(app.stage).toBeInstanceOf(pixi.Container);

    const ticker = new pixi.Ticker();
    expect(typeof ticker.add).toBe("function");
    expect(typeof ticker.remove).toBe("function");
    expect(typeof ticker.deltaMS).toBe("number");

    expect(typeof pixi.WebGLRenderer.prototype.generateTexture).toBe(
      "function",
    );
    expect("screen" in pixi.WebGLRenderer.prototype).toBe(true);
  });
});
