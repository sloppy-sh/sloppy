import { describe, expect, it } from "vitest";
import { REF } from "./fixtures/note";
import { noteNamed, onTheWeb } from "./links";

describe("which note a link names", () => {
  it("names one by its ref, cited or bare", () => {
    expect(noteNamed(`sloppy:${REF}`)).toEqual({ note: REF });
    expect(noteNamed(REF)).toEqual({ note: REF });
  });

  it("names one by its address", () => {
    expect(noteNamed("1a2")).toEqual({ address: "1a2" });
    expect(noteNamed("sloppy:3")).toEqual({ address: "3" });
  });

  it("names none for a link out of the graph", () => {
    expect(noteNamed("https://example.com/1a")).toBeUndefined();
    expect(noteNamed("mailto:someone@example.com")).toBeUndefined();
    expect(noteNamed("a1")).toBeUndefined();
  });
});

describe("a link to the web", () => {
  it("is one to a page over http or https, and nothing else", () => {
    expect(onTheWeb("https://example.com")).toBe(true);
    expect(onTheWeb("HTTP://example.com")).toBe(true);
    expect(onTheWeb("mailto:someone@example.com")).toBe(false);
    expect(onTheWeb("docs/plan.md")).toBe(false);
  });
});
