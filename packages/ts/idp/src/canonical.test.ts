import { describe, expect, it } from "vitest";
import { canonicalize } from "./canonical.js";

describe("JCS canonicalization", () => {
  it("sorts by UTF-16 code unit and not by locale", () => {
    // RFC 8785's French example: the point is that "péché" precedes "pêche",
    // which is the opposite of what French collation would say.
    expect(
      canonicalize({
        peach: "This sorting order",
        péché: "is wrong according to French",
        pêche: "but canonicalization MUST",
        sin: "ignore locale",
      }),
    ).toBe(
      '{"peach":"This sorting order","péché":"is wrong according to French",' +
        '"pêche":"but canonicalization MUST","sin":"ignore locale"}',
    );
  });

  it("sorts a surrogate pair by its lead unit, below U+FB33", () => {
    // Escapes rather than literals: the ordering claim is about code units, and
    // a source file that got normalised would quietly test something else.
    const euro = "\u20AC";
    const grin = "\uD83D\uDE00";
    const dalet = "\uFB33";
    expect(canonicalize({ [dalet]: 1, [grin]: 2, [euro]: 3 })).toBe(
      `{"${euro}":3,"${grin}":2,"${dalet}":1}`,
    );
  });

  it("does not depend on the order the keys were written in", () => {
    const one = canonicalize({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } });
    const other = canonicalize({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 });
    expect(one).toBe(other);
    expect(one).toBe('{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}');
  });

  it("writes numbers in ECMAScript's shortest round-tripping form", () => {
    expect(canonicalize({ n: 1e21 })).toBe('{"n":1e+21}');
    expect(canonicalize({ n: 0.1 })).toBe('{"n":0.1}');
    expect(canonicalize({ n: -0 })).toBe('{"n":0}');
    expect(canonicalize({ n: 1 })).toBe('{"n":1}');
  });

  it("escapes what JSON escapes and nothing more", () => {
    expect(canonicalize({ k: '"\\\n\t' })).toBe('{"k":"\\"\\\\\\n\\t\\u0001"}');
    expect(canonicalize({ k: "é😀" })).toBe('{"k":"é😀"}');
  });

  it("omits an absent member rather than writing it", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("refuses a value with no canonical form", () => {
    expect(() => canonicalize({ n: Number.NaN })).toThrow();
    expect(() => canonicalize({ n: Number.POSITIVE_INFINITY })).toThrow();
    // biome-ignore lint/suspicious/noExplicitAny: the point is the value tsc would refuse.
    expect(() => canonicalize({ n: 1n } as any)).toThrow();
  });

  it("survives the round trip back into the object it came from", () => {
    const value = { z: [1, "two", null, true], a: { nested: "deep" } };
    expect(JSON.parse(canonicalize(value))).toEqual(value);
  });
});
