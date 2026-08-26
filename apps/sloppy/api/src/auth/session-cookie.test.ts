import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { readCredential } from "./session-cookie";

function request(headers: Record<string, string>): Request {
  return { headers } as unknown as Request;
}

describe("reading the credential off a request", () => {
  it("takes the bearer token", () => {
    expect(readCredential(request({ authorization: "Bearer abc123" }))).toBe(
      "abc123",
    );
    expect(readCredential(request({ authorization: "bearer  abc123 " }))).toBe(
      "abc123",
    );
  });

  it("takes the session cookie out of a jar with others in it", () => {
    expect(
      readCredential(
        request({ cookie: "theme=dark; sloppy_session=abc123; other=1" }),
      ),
    ).toBe("abc123");
  });

  it("prefers the header, so a stale cookie cannot shadow it", () => {
    expect(
      readCredential(
        request({
          authorization: "Bearer fresh",
          cookie: "sloppy_session=old",
        }),
      ),
    ).toBe("fresh");
  });

  it("finds nothing where nothing was sent", () => {
    const nothing: Record<string, string>[] = [
      {},
      { authorization: "Basic abc" },
      { authorization: "Bearer   " },
      { cookie: "theme=dark" },
      { cookie: "sloppy_session=" },
    ];

    for (const headers of nothing) {
      expect(readCredential(request(headers))).toBeUndefined();
    }
  });
});
