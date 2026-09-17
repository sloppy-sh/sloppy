import { encodeText } from "@sloppy/vault";
import { describe, expect, it } from "vitest";
import {
  CREDENTIALS_FILE,
  credentialFor,
  DeviceCredentials,
  readCredentials,
  remoteHost,
  writeCredentials,
} from "./credentials.js";
import { MemoryFiles } from "./files.js";

function data(): MemoryFiles {
  return new MemoryFiles({ root: "/data" });
}

const TOKEN = { kind: "token", token: "a-token" } as const;

describe("the host a folder is kept at", () => {
  it("is read the same from both ways of spelling an address", () => {
    for (const said of [
      "https://example.test/ada/garden.git",
      "https://ada@example.test/ada/garden.git",
      "https://example.test:443/ada/garden.git",
      "ssh://git@example.test:2222/ada/garden.git",
      "git@example.test:ada/garden.git",
      "  git@EXAMPLE.test:ada/garden.git  ",
    ]) {
      expect(remoteHost(said)).toBe("example.test");
    }
  });

  it("is nothing for an address with no host in it", () => {
    expect(remoteHost("/Users/ada/garden")).toBeUndefined();
    expect(remoteHost("file:///Users/ada/garden")).toBeUndefined();
    expect(remoteHost("")).toBeUndefined();
  });
});

describe("what this device was given to reach a host", () => {
  it("is nothing until somebody says", async () => {
    expect(await readCredentials(data())).toEqual([]);
  });

  it("is matched to a folder by the host its address is at", async () => {
    const held = data();
    await writeCredentials(held, [
      { host: "example.test", credential: { kind: "token", token: "a-token" } },
      {
        host: "elsewhere.test",
        credential: { kind: "ssh", key: { kind: "kept" } },
      },
    ]);

    const kept = await readCredentials(held);
    expect(credentialFor(kept, "git@example.test:ada/garden.git")).toEqual(
      TOKEN,
    );
    expect(
      credentialFor(kept, "https://elsewhere.test/ada/garden.git"),
    ).toEqual({ kind: "ssh", key: { kind: "kept" } });
    expect(
      credentialFor(kept, "https://nobody.test/ada/garden.git"),
    ).toBeUndefined();
    expect(credentialFor(kept, "/Users/ada/garden")).toBeUndefined();
  });

  it("keeps the name a host wants beside the token where there is one", async () => {
    const held = data();
    await writeCredentials(held, [
      {
        host: "example.test",
        credential: { kind: "token", username: "ada", token: "a-token" },
      },
    ]);

    expect(await readCredentials(held)).toEqual([
      {
        host: "example.test",
        credential: { kind: "token", username: "ada", token: "a-token" },
      },
    ]);
  });

  it("leaves out what it cannot read and keeps the rest", async () => {
    const held = data();
    await held.write(
      CREDENTIALS_FILE,
      encodeText(
        JSON.stringify([
          { host: "example.test", credential: { kind: "token" } },
          { host: "", credential: { kind: "token", token: "a-token" } },
          { credential: { kind: "token", token: "a-token" } },
          {
            host: "elsewhere.test",
            credential: { kind: "token", token: "a-token" },
          },
        ]),
      ),
    );

    expect(await readCredentials(held)).toEqual([
      { host: "elsewhere.test", credential: TOKEN },
    ]);

    await held.write(CREDENTIALS_FILE, encodeText("{ not json"));
    expect(await readCredentials(held)).toEqual([]);
  });

  it("holds one per host, in place of what was there, and lets go", async () => {
    const files = new MemoryFiles({ data: "/data" });
    const held = new DeviceCredentials(files);

    await held.hold("example.test", { kind: "token", token: "a-token" });
    await held.hold("example.test", { kind: "token", token: "another" });
    await held.hold("elsewhere.test", { kind: "ssh", key: { kind: "kept" } });

    expect(await held.list()).toEqual([
      { host: "example.test", credential: { kind: "token", token: "another" } },
      {
        host: "elsewhere.test",
        credential: { kind: "ssh", key: { kind: "kept" } },
      },
    ]);
    expect(await held.forUrl("https://example.test/ada/garden.git")).toEqual({
      kind: "token",
      token: "another",
    });

    await held.forget("EXAMPLE.test");
    expect((await held.list()).map((one) => one.host)).toEqual([
      "elsewhere.test",
    ]);
  });
});
