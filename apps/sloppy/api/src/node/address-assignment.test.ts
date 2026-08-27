import type { Address } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import { nextChildAddress } from "./address-assignment";

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

  it("gives the same answer whatever order the siblings arrive in", () => {
    const siblings = ["1c", "1a", "1b", "1e", "1d"];
    expect(nextChildAddress("1", siblings)).toBe("1f");
    expect(nextChildAddress("1", [...siblings].reverse())).toBe("1f");
  });
});
