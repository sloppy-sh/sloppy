import { describe, expect, it } from "vitest";
import {
  AUTHOR_FACE_LONGEST,
  AUTHOR_READ,
  type AuthorAsked,
  type AuthorRead,
  type FieldNote,
  isServeCode,
  makeServeCode,
  NOT_PUBLIC_SAID,
  SERVE_ALPN,
  SERVE_CODE_LENGTH,
  SERVE_FIRST_LINE_MS,
  SERVE_PAIR_WINDOW_MS,
  SERVE_REACHES,
  SERVE_REFUSALS,
  UNREACHED_SAID,
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

describe("who an author is, asked of the desk", () => {
  it("is its own method, refused in words a person can act on", () => {
    expect(AUTHOR_READ).toBe("author/read");
    expect(AUTHOR_FACE_LONGEST).toBe(128);
    expect(SERVE_REFUSALS.NOT_PUBLIC).toBe(-32050);
    expect(SERVE_REFUSALS.UNREACHED).toBe(-32051);
    const codes = Object.values(SERVE_REFUSALS);
    expect(new Set(codes).size).toBe(codes.length);
    for (const said of [NOT_PUBLIC_SAID, UNREACHED_SAID]) {
      expect(said).not.toMatch(/evault|registry|ontology|ename|w3id|envelope/i);
    }
  });

  it("is answered in the shape a headset reads, every field optional", () => {
    const named: AuthorRead = { name: "Ada", handle: "ada", picture: "iVBOR" };
    const unnamed: AuthorRead = {};
    const asked: AuthorAsked = {
      principal: "w3id:@00000000-0000-5000-8000-000000000001",
    };
    const field: FieldNote = {
      note: "did:syr:z6Mk/01M75GHRF2M14C1GBX3ENP3SRD",
      title: "a.ts",
      tags: [],
      links: [],
      authors: [asked.principal],
    };
    expect(Object.keys(named)).toEqual(["name", "handle", "picture"]);
    expect(unnamed).toEqual({});
    expect(field.authors).toEqual([asked.principal]);
  });
});
