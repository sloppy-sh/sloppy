import { describe, expect, it } from "vitest";
import { cssColour, isDark, lightness, lookProperties } from "./look";

describe("a look as the page draws it", () => {
  it("reads a colour as CSS or as an OKLCH triple", () => {
    expect(cssColour([0.5, 0.1, 200])).toBe("oklch(0.5 0.1 200)");
    expect(cssColour("oklch(0.9 0 0)")).toBe("oklch(0.9 0 0)");
    expect(cssColour("red; background: url(x)")).toBeUndefined();
    expect(cssColour([0.5, "x" as unknown as number, 1])).toBeUndefined();
  });

  it("knows how light a colour is from any form it is given in", () => {
    expect(lightness([0.2, 0, 0])).toBe(0.2);
    expect(lightness("oklch(97% 0 0)")).toBeCloseTo(0.97);
    expect(lightness("#000")).toBe(0);
    expect(lightness("rgb(255 255 255)")).toBeCloseTo(1);
    expect(lightness("canvas")).toBeUndefined();
  });

  it("is dark where its paper is", () => {
    expect(isDark({ paper: "#111" })).toBe(true);
    expect(isDark({ paper: [0.97, 0, 0] })).toBe(false);
    expect(isDark()).toBe(false);
  });

  it("reads each role in the face named, its own where none is carried", () => {
    const drawn = lookProperties({
      faces: { ui: "opendyslexic", heading: "system", mono: "firacode" },
      density: "compact",
    });
    expect(drawn["--face-ui"]).toMatch(/^"OpenDyslexic"/);
    expect(drawn["--face-heading"]).toMatch(/^"Inter"/);
    expect(drawn["--face-mono"]).toMatch(/^"Fira Code"/);
    expect(drawn["--closeness"]).toBe("0.6");
    expect(lookProperties({ faces: { ui: "apple" } })["--face-ui"]).toBe(
      "system-ui, sans-serif",
    );
  });
});
