import { compareOrd } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import { InvalidOrderKeyError, orderKeyBetween } from "./fractional-index";

/** The order the stack renders in, so a test that sorts is testing the product. */
const inOrder = (keys: readonly string[]) => [...keys].sort(compareOrd);

describe("the order key", () => {
  it("matches the published values of the algorithm it implements", () => {
    expect(orderKeyBetween(null, null)).toBe("a0");
    expect(orderKeyBetween("a0", null)).toBe("a1");
    expect(orderKeyBetween(null, "a0")).toBe("Zz");
    expect(orderKeyBetween("a0", "a1")).toBe("a0V");
    expect(orderKeyBetween("a0V", "a1")).toBe("a0l");
    expect(orderKeyBetween("Zz", "a0")).toBe("ZzV");
  });

  it("refuses two keys the wrong way round, and a key that is not one", () => {
    expect(() => orderKeyBetween("a1", "a0")).toThrow(InvalidOrderKeyError);
    expect(() => orderKeyBetween("a0", "a0")).toThrow(InvalidOrderKeyError);
    expect(() => orderKeyBetween("!", null)).toThrow(InvalidOrderKeyError);
    expect(() => orderKeyBetween("a00", null)).toThrow(InvalidOrderKeyError);
  });

  it("carries past the end of the integer part in both directions", () => {
    let key = "a0";
    for (let i = 0; i < 200; i++) key = orderKeyBetween(key, null);
    expect(key).toBe("b2E");
    let low = "a0";
    for (let i = 0; i < 200; i++) low = orderKeyBetween(null, low);
    expect(compareOrd(low, "a0")).toBe(-1);
  });
});

// Repeatedly inserting at the SAME point is the pathological case: base-62
// buys about one extra character per six insertions, against a constant three
// for the ordinary one. The lengths below are pinned rather than bounded
// loosely, so a change to the algorithm has to be a deliberate one.
describe("a thousand insertions in the same place", () => {
  it("keeps every key ordered and short when they land after one block", () => {
    const left = "a0";
    const keys: string[] = [];
    let right: string | null = null;
    for (let i = 0; i < 1000; i++) {
      right = orderKeyBetween(left, right);
      keys.push(right);
    }
    // Each key lands before the one written before it, so reversing the writes
    // is the order the stack must be in.
    expect(inOrder(keys)).toEqual([...keys].reverse());
    expect(new Set(keys).size).toBe(1000);
    expect(Math.max(...keys.map((key) => key.length))).toBe(169);
  });

  it("keeps every key ordered and short when they land before one block", () => {
    const right = "a1";
    const keys: string[] = [];
    let left = "a0";
    for (let i = 0; i < 1000; i++) {
      left = orderKeyBetween(left, right);
      keys.push(left);
    }
    expect(inOrder(keys)).toEqual(keys);
    expect(new Set(keys).size).toBe(1000);
    expect(Math.max(...keys.map((key) => key.length))).toBe(202);
  });

  it("stays two or three characters when they land at the end", () => {
    const keys: string[] = [];
    let last: string | null = null;
    for (let i = 0; i < 1000; i++) {
      last = orderKeyBetween(last, null);
      keys.push(last);
    }
    expect(inOrder(keys)).toEqual(keys);
    expect(Math.max(...keys.map((key) => key.length))).toBe(3);
  });
});

describe("a stack shuffled by random insertions", () => {
  it("reads back in the order the insertions describe", () => {
    // A small deterministic source: the point is a fixed sequence a failure can
    // be replayed from, not statistical spread.
    let state = 12345;
    const next = (bound: number) => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state % bound;
    };

    const stack: string[] = [];
    for (let step = 0; step < 2000; step++) {
      const at = stack.length === 0 ? 0 : next(stack.length + 1);
      const key = orderKeyBetween(
        at === 0 ? null : stack[at - 1],
        at === stack.length ? null : stack[at],
      );
      stack.splice(at, 0, key);
    }
    expect(inOrder(stack)).toEqual(stack);
    expect(new Set(stack).size).toBe(2000);
  });
});
