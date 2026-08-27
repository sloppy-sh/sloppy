import { describe, expect, it, vi } from "vitest";
import { SignedTokens } from "./signed-token";

const SECRET = "a-secret-that-is-long-enough-to-be-one";

function tokens(ttlMs = 60_000) {
  return new SignedTokens<{ inst: string; redirect?: string }>(SECRET, ttlMs);
}

describe("a signed token", () => {
  it("carries its payload back, and only the payload", () => {
    const codec = tokens();
    const token = codec.issue({ inst: "https://syr.is", redirect: "/graph" });

    expect(codec.consume(token)).toEqual({
      inst: "https://syr.is",
      redirect: "/graph",
    });
  });

  it("is a different token every time, so two logins never collide", () => {
    const codec = tokens();
    const payload = { inst: "https://syr.is" };

    expect(codec.issue(payload)).not.toBe(codec.issue(payload));
  });

  it("refuses one whose payload was edited after signing", () => {
    const codec = tokens();
    const token = codec.issue({ inst: "https://syr.is" });
    const forged = Buffer.from(
      JSON.stringify({ inst: "https://attacker.example", t: Date.now() }),
      "utf8",
    ).toString("base64url");

    expect(codec.consume(`${forged}.${token.split(".")[1]}`)).toBeNull();
  });

  it("refuses one signed with a different key", () => {
    const token = tokens().issue({ inst: "https://syr.is" });
    const other = new SignedTokens<{ inst: string }>("another-secret", 60_000);

    expect(other.consume(token)).toBeNull();
  });

  it("refuses the second presentation of the same token", () => {
    const codec = tokens();
    const token = codec.issue({ inst: "https://syr.is" });

    expect(codec.consume(token)).not.toBeNull();
    expect(codec.consume(token)).toBeNull();
  });

  it("takes it as many times as it is shown where nothing spends it", () => {
    const codec = tokens();
    const token = codec.issue({ inst: "https://syr.is" });

    expect(codec.verify(token)).toEqual({ inst: "https://syr.is" });
    expect(codec.verify(token)).toEqual({ inst: "https://syr.is" });
    expect(codec.consume(token)).not.toBeNull();
  });

  it("refuses one older than its lifetime", () => {
    vi.useFakeTimers();
    try {
      const codec = tokens(1_000);
      const token = codec.issue({ inst: "https://syr.is" });
      vi.advanceTimersByTime(1_001);

      expect(codec.consume(token)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses anything that is not one", () => {
    const codec = tokens();

    for (const junk of ["", ".", "a.b.c", "nodot", "a.", ".b"]) {
      expect(codec.consume(junk)).toBeNull();
    }
  });
});
