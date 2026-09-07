import type { Address } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import { movedSubtree, nextChildAddress } from "./address-assignment";

describe("the next address under a parent", () => {
  it("opens a graph at 1 and a branch at its first child", () => {
    expect(nextChildAddress(null, [])).toBe("1");
    expect(nextChildAddress("1", [])).toBe("1a");
    expect(nextChildAddress("1a", [])).toBe("1a1");
  });

  it("follows the run of siblings already there", () => {
    expect(nextChildAddress(null, ["1", "2", "3"])).toBe("4");
    expect(nextChildAddress("1", ["1a", "1b"])).toBe("1c");
    expect(nextChildAddress("1a", ["1a1", "1a2"])).toBe("1a3");
  });

  it("reads the run by ordinal, not by spelling", () => {
    const past26: Address[] = Array.from({ length: 26 }, (_, i) =>
      `1${String.fromCharCode(97 + i)}`.toString(),
    );
    expect(nextChildAddress("1", past26)).toBe("1aa");
    expect(nextChildAddress("1", ["1a", "1z", "1aa"])).toBe("1ab");
    expect(nextChildAddress(null, ["1", "9", "10"])).toBe("11");
  });

  it("does not reuse the address of a note taken out of the middle", () => {
    expect(nextChildAddress("1", ["1a", "1c"])).toBe("1d");
  });

  it("passes over an address spent under a parent that has since moved", () => {
    // The rows an address is spent on are read by the parent it hung under, so
    // a move hands this run addresses from the run that parent used to be in.
    // Following one would put the new note beside a note in another run.
    expect(nextChildAddress("2c", ["2c1", "1a1"])).toBe("2c2");
    expect(nextChildAddress("2c", ["1a1", "1a2"])).toBe("2c1");
    expect(nextChildAddress(null, ["1", "1a"])).toBe("2");
    expect(nextChildAddress("1", ["1a", "2"])).toBe("1b");
  });

  it("gives the same answer whatever order the siblings arrive in", () => {
    const siblings = ["1c", "1a", "1b", "1e", "1d"];
    expect(nextChildAddress("1", siblings)).toBe("1f");
    expect(nextChildAddress("1", [...siblings].reverse())).toBe("1f");
  });
});

/** The run under one parent as a graph hands it over: the addresses notes are
 *  at, and the ones notes have left behind. */
function run(live: readonly Address[], gone: readonly Address[]): Address[] {
  return [...live, ...gone];
}

describe("an address a note has left behind", () => {
  it("does not go to the note written after the greatest sibling", () => {
    expect(nextChildAddress("1", run(["1a", "1b"], ["1c"]))).toBe("1d");
  });

  it("does not come back when the only child goes", () => {
    expect(nextChildAddress("1", run([], ["1a"]))).toBe("1b");
  });

  it("stays spent for every note a deleted branch took with it", () => {
    // Deleting 1b takes 1b1 and 1b1a with it, and all three numbers go with
    // them: a citation of any one must never resolve to a later thought.
    expect(nextChildAddress("1", run(["1a"], ["1b"]))).toBe("1c");
    expect(nextChildAddress("1b", run([], ["1b1"]))).toBe("1b2");
    expect(nextChildAddress("1b1", run([], ["1b1a"]))).toBe("1b1b");
  });

  it("leaves a branch number spent too", () => {
    expect(nextChildAddress(null, run(["1", "2"], ["3"]))).toBe("4");
  });
});

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
