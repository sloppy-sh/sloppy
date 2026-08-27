import { describe, expect, it } from "vitest";
import { isAllowedRedirect, isDeepLink, withParams } from "./redirect-target";

describe("where sign-in may put somebody down", () => {
  it("allows the four shapes Sloppy actually runs on", () => {
    for (const target of [
      "/",
      "/graph/1a",
      "tauri://localhost/auth/callback",
      "http://tauri.localhost/",
      "https://tauri.localhost/auth/callback",
      "sloppy://auth/callback",
      "sloppy://auth/callback?from=native",
      "http://localhost:1234/",
      "http://localhost:1234",
    ]) {
      expect(isAllowedRedirect(target), target).toBe(true);
    }
  });

  it("refuses a host that only looks like a path", () => {
    // `//evil.example` is an absolute URL. A leading slash is not enough.
    for (const target of [
      "//evil.example",
      "//evil.example/graph",
      "/\\evil.example",
    ]) {
      expect(isAllowedRedirect(target), target).toBe(false);
    }
  });

  it("refuses anywhere else on the internet", () => {
    for (const target of [
      "https://evil.example",
      "https://tauri.localhost.evil.example/",
      "javascript:alert(1)",
      "data:text/html,hi",
      "sloppy://auth/elsewhere",
      "http://localhost/",
      "",
      undefined,
      42,
    ]) {
      expect(isAllowedRedirect(target), String(target)).toBe(false);
    }
  });

  it("knows which target a browser will not follow on its own", () => {
    expect(isDeepLink("sloppy://auth/callback?a=1")).toBe(true);
    expect(isDeepLink("http://localhost:1234/")).toBe(false);
    expect(isDeepLink("/graph")).toBe(false);
  });
});

describe("adding parameters to a target", () => {
  it("starts a query, or extends the one already there", () => {
    expect(withParams("/graph", { a: "1" })).toBe("/graph?a=1");
    expect(withParams("/graph?b=2", { a: "1" })).toBe("/graph?b=2&a=1");
  });

  it("escapes what it is given", () => {
    expect(withParams("/", { sloppy_error: "Try again later." })).toBe(
      "/?sloppy_error=Try+again+later.",
    );
  });

  it("leaves a target that still matches its own shape", () => {
    const target = withParams("sloppy://auth/callback", { sloppy_code: "x" });

    expect(isAllowedRedirect(target)).toBe(true);
    expect(isDeepLink(target)).toBe(true);
  });
});
