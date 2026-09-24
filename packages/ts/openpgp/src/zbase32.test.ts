import { sha1 } from "@noble/hashes/legacy.js";
import { describe, expect, it } from "vitest";
import { zBase32 } from "./zbase32.js";

describe("z-base-32", () => {
  it("spells the hash the Web Key Directory specification publishes", () => {
    expect(zBase32(sha1(new TextEncoder().encode("joe.doe")))).toBe(
      "iy9q119eutrkn8s1mk4r39qejnbu3n5q",
    );
  });

  it("fills out a last character that is short of five bits", () => {
    expect(zBase32(new Uint8Array([0x00]))).toBe("yy");
    expect(zBase32(new Uint8Array([0xff]))).toBe("9h");
  });

  it("writes nothing for nothing", () => {
    expect(zBase32(new Uint8Array())).toBe("");
  });
});
