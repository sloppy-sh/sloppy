import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { isReachableRemoteHost, ownOrigin, reachableUrl } from "./remote-host";

const strict = { allowPrivate: false };
const permissive = { allowPrivate: true };

describe("isReachableRemoteHost", () => {
  it.each([
    "169.254.169.254",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "fe80::1",
    "ff02::1",
    // A mapped literal reaches the v4 host, so the v4 answer governs it.
    "::ffff:169.254.169.254",
    "::ffff:a9fe:a9fe",
    "::ffff:0.0.0.0",
  ])("refuses %s whatever the deployment allows", (host) => {
    expect(isReachableRemoteHost(host, strict)).toBe(false);
    expect(isReachableRemoteHost(host, permissive)).toBe(false);
  });

  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "100.64.0.1",
    "::1",
    "fd00::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "0:0:0:0:0:ffff:127.0.0.1",
    "::127.0.0.1",
    "::ffff:10.1.2.3",
    "::ffff:192.168.1.1",
    "localhost",
    "minio.localhost",
  ])("refuses %s in production and allows it in development", (host) => {
    expect(isReachableRemoteHost(host, strict)).toBe(false);
    expect(isReachableRemoteHost(host, permissive)).toBe(true);
  });

  it.each([
    "203.0.113.5",
    "8.8.8.8",
    "2606:4700::1111",
    "::ffff:8.8.8.8",
    "syr.example",
  ])("reaches %s either way", (host) => {
    expect(isReachableRemoteHost(host, strict)).toBe(true);
    expect(isReachableRemoteHost(host, permissive)).toBe(true);
  });

  it("refuses 172.15 and 172.32, which are not the private block", () => {
    expect(isReachableRemoteHost("172.15.0.1", strict)).toBe(true);
    expect(isReachableRemoteHost("172.32.0.1", strict)).toBe(true);
  });
});

describe("reachableUrl", () => {
  it.each([
    "file:///etc/passwd",
    "data:text/html,<script>",
    "not a url",
    "http://169.254.169.254/latest/meta-data/",
  ])("refuses %s", (target) => {
    expect(() => reachableUrl(target, strict)).toThrow(ForbiddenException);
  });

  it("reaches this instance's own address even where the policy would not", () => {
    const own = "http://localhost:8030";
    expect(() => reachableUrl(`${own}/x.png`, strict)).toThrow();
    expect(
      reachableUrl(`${own}/x.png`, {
        ...strict,
        ownOrigin: ownOrigin(own),
      }).toString(),
    ).toBe(`${own}/x.png`);
  });

  it("exempts nothing when the configured address is unreadable", () => {
    expect(ownOrigin("not a url")).toBeUndefined();
  });
});
