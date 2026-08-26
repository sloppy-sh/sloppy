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
});
