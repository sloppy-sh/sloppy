import { compareOrd, type OwnedRef } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import { ordAfter, type Placed, UnknownNeighbourError } from "./placement";

const DID = "did:syr:z6MkAdaAdaAdaAdaAdaAdaAdaAdaAdaAda";
const ref = (n: number): OwnedRef =>
  `${DID}/${String(n).padStart(26, "0")}` as OwnedRef;

const stack: Placed[] = [
  { ref: ref(1), ord: "a0" },
  { ref: ref(2), ord: "a1" },
  { ref: ref(3), ord: "a2" },
];

describe("where a block lands", () => {
  it("opens an empty stack", () => {
    expect(ordAfter([], null)).toBe("a0");
  });

  it("goes to the top when it follows nothing", () => {
    expect(compareOrd(ordAfter(stack, null), "a0")).toBe(-1);
  });

  it("goes between the named block and the next one", () => {
    const ord = ordAfter(stack, ref(2));
    expect(compareOrd("a1", ord)).toBe(-1);
    expect(compareOrd(ord, "a2")).toBe(-1);
  });

  it("goes past the end when it follows the last block", () => {
    expect(compareOrd("a2", ordAfter(stack, ref(3)))).toBe(-1);
  });

  it("lands past both blocks holding the same place", () => {
    const twinned: Placed[] = [
      { ref: ref(1), ord: "a0" },
      { ref: ref(2), ord: "a1" },
      { ref: ref(3), ord: "a1" },
      { ref: ref(4), ord: "a2" },
    ];
    const ord = ordAfter(twinned, ref(2));
    expect(compareOrd("a1", ord)).toBe(-1);
    expect(compareOrd(ord, "a2")).toBe(-1);
  });

  it("refuses a neighbour that is not in this stack", () => {
    expect(() => ordAfter(stack, ref(9))).toThrow(UnknownNeighbourError);
  });
});
