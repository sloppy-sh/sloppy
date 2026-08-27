import type { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";
import type { AppConfigService } from "../config/app-config.service";
import { AssetLinks } from "./asset-link";

const HERE = "https://sloppy.example";
const PICTURE = "https://blobs.peer.example/a.png";

function links(secret = "a-session-secret-long-enough-to-be-one"): AssetLinks {
  return new AssetLinks(
    { publicUrl: HERE } as AppConfigService,
    {
      get: () => secret,
    } as unknown as ConfigService,
  );
}

function refIn(link: string): string {
  return new URL(link).searchParams.get("ref") ?? "";
}

describe("the address a picture is rendered from", () => {
  it("is on this instance, and carries what it stands for", () => {
    const link = links().to(PICTURE);
    const at = new URL(link);

    expect(at.origin).toBe(HERE);
    expect(at.pathname).toBe("/api/proxy");
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

  // A surface only ever holds links, so saving a picture means sending one back.
  it("resolves a link of its own, and leaves anything else alone", () => {
    const mine = links();

    expect(mine.unwrap(mine.to(PICTURE))).toBe(PICTURE);
    expect(mine.unwrap(PICTURE)).toBe(PICTURE);
    expect(mine.unwrap(`${HERE}/api/proxy?ref=nonsense`)).toBe(
      `${HERE}/api/proxy?ref=nonsense`,
    );
    expect(mine.unwrap("https://elsewhere.example/api/proxy?ref=x")).toBe(
      "https://elsewhere.example/api/proxy?ref=x",
    );
  });
});
