import { describe, expect, it } from "vitest";
import {
  isServeCode,
  makeServeCode,
  SERVE_ALPN,
  SERVE_CODE_LENGTH,
  SERVE_FIRST_LINE_MS,
  SERVE_PAIR_WINDOW_MS,
  SERVE_REACHES,
} from "./serve.js";

describe("a pairing code", () => {
  it("is six digits, leading zeroes kept", () => {
    expect(makeServeCode(() => 0)).toBe("000000");
    expect(makeServeCode(() => 0.999999)).toBe("999999");
    for (let at = 0; at < 50; at++) {
      const code = makeServeCode(Math.random);
      expect(code).toHaveLength(SERVE_CODE_LENGTH);
      expect(isServeCode(code)).toBe(true);
    }
  });

  it("refuses anything that is not six digits", () => {
    for (const held of ["12345", "1234567", "12a456", " 12345", 123456, null]) {
      expect(isServeCode(held)).toBe(false);
    }
  });
});

describe("what every place serving agrees on", () => {
  it("is the protocol, the waits and the two reaches, as the desk and the headset spell them", () => {
    expect(SERVE_ALPN).toBe("sloppy/serve/1");
    expect(SERVE_PAIR_WINDOW_MS).toBe(120_000);
    expect(SERVE_FIRST_LINE_MS).toBe(10_000);
    expect(SERVE_REACHES).toEqual(["local", "anywhere"]);
  });
});
