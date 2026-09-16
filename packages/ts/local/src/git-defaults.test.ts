import { encodeText } from "@sloppy/vault";
import { describe, expect, it } from "vitest";
import { MemoryFiles } from "./files.js";
import {
  GIT_DEFAULTS_FILE,
  readGitDefaults,
  writeGitDefaults,
} from "./git-defaults.js";

function data(): MemoryFiles {
  return new MemoryFiles({ root: "/data" });
}

describe("what a folder started on this device begins with", () => {
  it("is nothing until somebody says", async () => {
    expect(await readGitDefaults(data())).toEqual({});
  });

  it("keeps who the commits are by and how they are signed", async () => {
    const held = data();
    await writeGitDefaults(held, {
      user: { name: "Ada", email: "ada@example.test" },
      signing: { kind: "ssh", key: { kind: "kept" } },
    });

    expect(await readGitDefaults(held)).toEqual({
      user: { name: "Ada", email: "ada@example.test" },
      signing: { kind: "ssh", key: { kind: "kept" } },
    });
  });

  it("keeps a key of somebody's own and a program of their own", async () => {
    const held = data();
    await writeGitDefaults(held, {
      signing: { kind: "openpgp", program: "gpg2", keyId: "9E3C" },
    });
    expect(await readGitDefaults(held)).toEqual({
      signing: { kind: "openpgp", program: "gpg2", keyId: "9E3C" },
    });

    await writeGitDefaults(held, {
      signing: { kind: "ssh", key: { kind: "file", path: "/keys/id_ed25519" } },
    });
    expect(await readGitDefaults(held)).toEqual({
      signing: { kind: "ssh", key: { kind: "file", path: "/keys/id_ed25519" } },
    });
  });

  it("reads a file it cannot make sense of as nobody having said", async () => {
    const held = data();
    await held.write(GIT_DEFAULTS_FILE, encodeText("{ not json"));
    expect(await readGitDefaults(held)).toEqual({});

    await held.write(
      GIT_DEFAULTS_FILE,
      encodeText(
        JSON.stringify({
          user: { name: "Ada" },
          signing: { kind: "carrier pigeon" },
        }),
      ),
    );
    expect(await readGitDefaults(held)).toEqual({});
  });
});
