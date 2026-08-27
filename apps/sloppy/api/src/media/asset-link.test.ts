import type { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";
import { AssetLinks } from "./asset-link";

const PICTURE = "https://blobs.peer.example/a.png";

function links(secret = "a-session-secret-long-enough-to-be-one"): AssetLinks {
  return new AssetLinks({ get: () => secret } as unknown as ConfigService);
}

function refIn(link: string): string {
  return new URLSearchParams(link.slice(link.indexOf("?"))).get("ref") ?? "";
}

describe("the address a picture is rendered from", () => {
  // This instance answers at more than one address — a shell forwarding /api,
  // the port the native app dials — and only the shell knows which of them it
  // can reach. An origin minted here would be a guess at that.
  it("is a path under the API, and carries what it stands for", () => {
    const link = links().to(PICTURE);

    expect(link.startsWith("/proxy?ref=")).toBe(true);
    expect(link).not.toContain("blobs.peer.example");
  });

  // A fresh address on every read would send a reader back for a picture their
  // browser is already holding.
  it("is the same address for the same picture", () => {
    const mine = links();
    expect(mine.to(PICTURE)).toBe(mine.to(PICTURE));
    expect(mine.to(PICTURE)).not.toBe(
      mine.to("https://blobs.peer.example/b.png"),
    );
  });

  it("reads back only what this instance minted", () => {
    const mine = links();
    expect(mine.target(refIn(mine.to(PICTURE)))).toBe(PICTURE);

    const theirs = links("a-different-instances-session-secret");
    expect(mine.target(refIn(theirs.to(PICTURE)))).toBeNull();
  });

  it("refuses a ref that names an address nobody signed for", () => {
    const mine = links();
    const forged = Buffer.from(
      JSON.stringify({ u: "https://attacker.example/", t: Date.now() }),
      "utf8",
    ).toString("base64url");
    const signature = refIn(mine.to(PICTURE)).split(".")[1];

    expect(mine.target(`${forged}.${signature}`)).toBeNull();
    expect(mine.target(undefined)).toBeNull();
    expect(mine.target("")).toBeNull();
  });
});
