import { describe, expect, it } from "vitest";
import { movedSubtree } from "./address-assignment";

describe("where a moved note and everything under it land", () => {
  it("takes the next address in the run it joins", () => {
    expect(movedSubtree("2", ["2a", "2b"], "1a", [])).toEqual(
      new Map([["1a", "2c"]]),
    );
    expect(movedSubtree(null, ["1", "2"], "1a", [])).toEqual(
      new Map([["1a", "3"]]),
    );
  });

  it("keeps every note under it where it was, relative to it", () => {
    expect(
      movedSubtree("2", ["2a", "2b"], "1a", ["1a1", "1a1a", "1a2"]),
    ).toEqual(
      new Map([
        ["1a", "2c"],
        ["1a1", "2c1"],
        ["1a1a", "2c1a"],
        ["1a2", "2c2"],
      ]),
    );
  });

  it("keeps the run each one is in when the depth it lands at changes", () => {
    // A note whose new address is a branch: what was its first child is now a
    // letter rather than a number, and the two of them stay in that order.
    expect(
      movedSubtree(null, ["1", "2"], "1a", ["1a1", "1a2", "1a1a"]),
    ).toEqual(
      new Map([
        ["1a", "3"],
        ["1a1", "3a"],
        ["1a2", "3b"],
        ["1a1a", "3a1"],
      ]),
    );
  });

  it("goes to the end of the run it is already in, and never back where it was", () => {
    // Dropped between two of its own siblings: the run appends, so neither of
    // them is renumbered and the address it leaves is never handed out again.
    expect(movedSubtree("1", ["1a", "1b", "1c"], "1a", ["1a1"])).toEqual(
      new Map([
        ["1a", "1d"],
        ["1a1", "1d1"],
      ]),
    );
  });

  it("steps past an address the run has spent, moved away from or not", () => {
    // The run as a graph hands it over: the notes there, the ones deleted, the
    // ones retired, and the addresses a move left behind.
    expect(movedSubtree("1", ["1a", "1b", "1c", "1d"], "2", [])).toEqual(
      new Map([["2", "1e"]]),
    );
  });

  it("lands past the run's own addresses and no others", () => {
    expect(movedSubtree("2c", ["2c1", "1a1"], "1b", ["1b1"])).toEqual(
      new Map([
        ["1b", "2c2"],
        ["1b1", "2c2a"],
      ]),
    );
    expect(movedSubtree("2c", ["1a1", "1a2"], "1b", ["1b1"])).toEqual(
      new Map([
        ["1b", "2c1"],
        ["1b1", "2c1a"],
      ]),
    );
  });
});
