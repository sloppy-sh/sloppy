import { afterEach, describe, expect, it } from "vitest";
import { apiUrl, getHost, isSameOrigin, proxied, setHost } from "./host.js";

afterEach(() => setHost(""));

describe("host", () => {
  it("defaults to same-origin, which is what the web shell wants", () => {
    expect(isSameOrigin()).toBe(true);
    expect(apiUrl("/health")).toBe("/api/health");
  });

  it("keeps one slash between an arbitrary host and the path", () => {
    setHost("https://sloppy.example/");
    expect(getHost()).toBe("https://sloppy.example");
    expect(apiUrl("/nodes")).toBe("https://sloppy.example/api/nodes");
    expect(isSameOrigin()).toBe(false);
  });

  it("sends a remote asset through the proxy and leaves a local one alone", () => {
    setHost("https://sloppy.example");
    expect(proxied("https://peer.example/a.png")).toBe(
      "https://sloppy.example/api/proxy?url=https%3A%2F%2Fpeer.example%2Fa.png",
    );
    expect(proxied("data:image/png;base64,AAAA")).toBe(
      "data:image/png;base64,AAAA",
    );
    expect(proxied("/favicon.svg")).toBe("/favicon.svg");
  });

  it("hands an address the API minted straight to the picture", () => {
    setHost("https://sloppy.example");
    const minted = "https://sloppy.example/api/proxy?ref=signed-token";

    expect(proxied(minted)).toBe(minted);
  });

  // Somebody else is free to answer with a URL shaped like ours, and rendering
  // that one raw is the leak the asset route exists to prevent.
  it("does not take a look-alike from anywhere but the API", () => {
    setHost("https://sloppy.example");
    const impostor = "https://peer.example/api/proxy?ref=signed-token";

    expect(proxied(impostor)).toBe(
      `https://sloppy.example/api/proxy?url=${encodeURIComponent(impostor)}`,
    );
  });
});
