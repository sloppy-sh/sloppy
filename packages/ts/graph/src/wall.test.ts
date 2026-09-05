// What the ground's picture promises: it is drawn under the paper laid over it,
// it composites nothing where there is nothing to see, and the bytes it was
// handed go back only once nothing is drawing them.

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { GraphPictures } from "./contract.js";

interface Fake {
  dataset: Record<string, string>;
  style: Record<string, string>;
  children: Fake[];
  parent: Fake | null;
  append(...kids: Fake[]): void;
  insertBefore(kid: Fake, before: Fake): void;
  remove(): void;
}

function element(): Fake {
  const node: Fake = {
    dataset: {},
    style: {} as Record<string, string>,
    children: [],
    parent: null,
    append(...kids) {
      for (const kid of kids) {
        kid.parent = node;
        node.children.push(kid);
      }
    },
    insertBefore(kid, before) {
      kid.parent = node;
      node.children.splice(node.children.indexOf(before), 0, kid);
    },
    remove() {
      node.parent?.children.splice(node.parent.children.indexOf(node), 1);
      node.parent = null;
    },
  };
  // `style.cssText` is written as a string and read back through the same bag,
  // which is enough for what is asserted below.
  Object.defineProperty(node.style, "cssText", {
    writable: true,
    value: "",
  });
  return node;
}

/** Every picture asked for decodes, unless its src says otherwise. */
let decoding: string[] = [];

beforeAll(() => {
  vi.stubGlobal("document", { createElement: () => element() });
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      decode(): Promise<void> {
        decoding.push(this.src);
        return this.src.includes("torn")
          ? Promise.reject(new Error("cannot decode"))
          : Promise.resolve();
      }
    },
  );
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => {
    run();
    return 0;
  });
});

afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  decoding = [];
});

const { WallLayer } = await import("./wall.js");

const stillLooking = { matches: false } as MediaQueryList;

function store(): GraphPictures & { released: string[]; asked: string[] } {
  const released: string[] = [];
  const asked: string[] = [];
  return {
    released,
    asked,
    read: async (picture) => {
      asked.push(picture);
      if (picture === "gone") return null;
      const src = `blob:${picture}`;
      return { src, release: () => released.push(src) };
    },
  };
}

/** The picture elements, which are everything before the scrim. */
function laid(wall: { element: unknown }): Fake[] {
  const held = wall.element as Fake;
  return held.children.slice(0, -1);
}

async function settled(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("the picture under the field", () => {
  it("composites nothing where nobody asked for one", () => {
    const pictures = store();
    const wall = new WallLayer(stillLooking);
    wall.show(null, pictures, 0);

    expect(wall.element.style.display).toBe("none");
    expect(pictures.asked).toEqual([]);
  });

  it("is laid under the paper, never over the field", async () => {
    const pictures = store();
    const wall = new WallLayer(stillLooking);
    wall.show("a", pictures, 0.3);
    await settled();

    const held = wall.element as unknown as Fake;
    expect(laid(wall)).toHaveLength(1);
    expect(laid(wall)[0].style.backgroundImage).toBe('url("blob:a")');
    // The scrim is last, so the paper is composited over the picture.
    expect(held.children.at(-1)?.style.opacity).toBe("0.7");
    expect(held.style.display).toBe("block");
  });

  it("goes quiet where the reader asked for none of it", async () => {
    const wall = new WallLayer(stillLooking);
    const pictures = store();
    wall.show("a", pictures, 0);
    await settled();

    expect(wall.element.style.display).toBe("none");
    expect(pictures.asked).toEqual([]);
  });

  it("fetches it once the reader asks to see some of it", async () => {
    const wall = new WallLayer(stillLooking);
    const pictures = store();
    wall.show("a", pictures, 0);
    await settled();
    wall.show("a", pictures, 0.4);
    await settled();

    expect(pictures.asked).toEqual(["a"]);
    expect(laid(wall)).toHaveLength(1);
    expect(wall.element.style.display).toBe("block");
  });

  it("draws nothing for a picture the store no longer holds", async () => {
    const wall = new WallLayer(stillLooking);
    wall.show("gone", store(), 0.3);
    await settled();

    expect(laid(wall)).toHaveLength(0);
    expect(wall.element.style.display).toBe("none");
  });

  it("hands back the bytes of a picture that will not decode", async () => {
    const pictures = store();
    const wall = new WallLayer(stillLooking);
    wall.show("torn", pictures, 0.3);
    await settled();

    expect(decoding).toEqual(["blob:torn"]);
    expect(pictures.released).toEqual(["blob:torn"]);
    expect(laid(wall)).toHaveLength(0);
  });

  // A ground that failed to arrive once falls to the plain theme, which is the
  // right failure; being unable to ask again is not. Nothing else in the app
  // re-asks — a theme change, a strength change and a return from the
  // background all come back with the same picture.
  it("asks again for a picture whose bytes never arrived", async () => {
    let attempts = 0;
    const pictures: GraphPictures = {
      read: (picture) => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new Error("nothing came back"))
          : Promise.resolve({ src: `blob:${picture}`, release: () => {} });
      },
    };
    const wall = new WallLayer(stillLooking);
    wall.show("a", pictures, 0.3);
    await settled();
    expect(laid(wall)).toHaveLength(0);

    wall.show("a", pictures, 0.3);
    await settled();
    expect(attempts).toBe(2);
    expect(laid(wall).map((one) => one.style.backgroundImage)).toEqual([
      'url("blob:a")',
    ]);
  });

  // A picture released while it is still on screen is a picture that blanks, so
  // the one being replaced holds its bytes for as long as it is drawn.
  it("keeps a picture's bytes until the next one has taken over", async () => {
    vi.useFakeTimers();
    try {
      const pictures = store();
      const wall = new WallLayer(stillLooking);
      wall.show("a", pictures, 0.3);
      await settled();
      expect(pictures.released).toEqual([]);

      wall.show("b", pictures, 0.3);
      await settled();
      expect(laid(wall).map((one) => one.style.backgroundImage)).toEqual([
        'url("blob:a")',
        'url("blob:b")',
      ]);
      expect(pictures.released).toEqual([]);

      vi.advanceTimersByTime(1000);
      expect(laid(wall).map((one) => one.style.backgroundImage)).toEqual([
        'url("blob:b")',
      ]);
      expect(pictures.released).toEqual(["blob:a"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops a picture the reader moved on from before it arrived", async () => {
    const pictures = store();
    const wall = new WallLayer(stillLooking);
    wall.show("a", pictures, 0.3);
    wall.show("b", pictures, 0.3);
    await settled();

    expect(pictures.asked).toEqual(["a", "b"]);
    expect(pictures.released).toEqual(["blob:a"]);
    expect(laid(wall).map((one) => one.style.backgroundImage)).toEqual([
      'url("blob:b")',
    ]);
  });

  // DESIGN.md § "A picture that takes turns": the ground and a mark take the same
  // three, and every one of them is transform and opacity alone.
  it("gives way with the transition the reader chose", async () => {
    const pictures = store();
    const wall = new WallLayer(stillLooking);
    wall.show("a", pictures, 0.3, "slide");
    await settled();
    wall.show("b", pictures, 0.3, "slide");
    await settled();

    const [leaving, arriving] = laid(wall);
    expect(arriving.style.transform).toBe("translateX(0%) scale(1)");
    expect(arriving.style.opacity).toBe("1");
    expect(leaving.style.transform).toBe("translateX(-100%) scale(1)");
    expect(leaving.style.opacity).toBe("0");
  });

  it("settles a zoom down to full size and never past it", async () => {
    const pictures = store();
    const wall = new WallLayer(stillLooking);
    wall.show("a", pictures, 0.3, "zoom");
    await settled();
    wall.show("b", pictures, 0.3, "zoom");
    await settled();

    const [leaving, arriving] = laid(wall);
    expect(arriving.style.transform).toBe("translateX(0%) scale(1)");
    expect(leaving.style.transform).toBe("translateX(0%) scale(1.06)");
  });

  // A transition a later Sloppy chose is stored and handed back untouched, and
  // meanwhile crossfades — the values are an open set the way a look's are.
  it("crossfades where it has no way to draw what was chosen", async () => {
    const pictures = store();
    const wall = new WallLayer(stillLooking);
    wall.show("a", pictures, 0.3, "kaleidoscope" as never);
    await settled();
    wall.show("b", pictures, 0.3, "kaleidoscope" as never);
    await settled();

    const [leaving, arriving] = laid(wall);
    expect(arriving.style.transform).toBe("translateX(0%) scale(1)");
    expect(leaving.style.transform).toBe("translateX(0%) scale(1)");
    expect(leaving.style.opacity).toBe("0");
  });

  // DESIGN.md § Motion: the picture changes without moving.
  it("changes without moving where the reader asked for less motion", async () => {
    const pictures = store();
    const wall = new WallLayer({ matches: true } as MediaQueryList);
    wall.show("a", pictures, 0.3, "slide");
    await settled();
    wall.show("b", pictures, 0.3, "slide");
    await settled();

    const laidNow = laid(wall);
    expect(laidNow).toHaveLength(1);
    expect(laidNow[0].style.backgroundImage).toBe('url("blob:b")');
    expect(laidNow[0].style.transform).toBeUndefined();
  });

  it("hands back what it is holding when the canvas goes", async () => {
    const pictures = store();
    const wall = new WallLayer(stillLooking);
    wall.show("a", pictures, 0.3);
    await settled();

    wall.destroy();
    expect(pictures.released).toEqual(["blob:a"]);
  });
});
