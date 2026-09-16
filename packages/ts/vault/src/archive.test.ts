import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { manifest, pack, unpack } from "./archive.js";
import {
  amendmentPath,
  encodeText,
  graphFile,
  mediaPath,
  notePath,
  type Vault,
  VAULT_FORMAT,
  VaultFormatError,
} from "./layout.js";

const OWNER = "did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE";
const GRAPH = "01J000000000000000000000GG";
const NOTE = "01J0000000000000000000000A";
const OTHER = "01J0000000000000000000000B";
const OFFER = "01J0000000000000000000000F";

function vault(): Vault {
  return new Map<string, Uint8Array>([
    [
      "graph.json",
      graphFile({
        format: VAULT_FORMAT,
        graph: GRAPH,
        name: "The garden",
        owner: OWNER,
      }),
    ],
    [notePath(NOTE), encodeText("---\nref: x\n---\n")],
    [notePath(OTHER), encodeText("---\nref: y\n---\n")],
    [amendmentPath(OFFER), encodeText("---\namends: x\n---\n")],
    [mediaPath("up1", "png"), new Uint8Array([1, 2, 3, 4])],
  ]);
}

describe("a vault as one file", () => {
  it("comes back as itself, the offers standing on it included", () => {
    const held = vault();
    const back = unpack(pack(held));
    expect(back).toEqual(held);
    expect(back.has(amendmentPath(OFFER))).toBe(true);
  });

  it("packs the same graph to the same bytes twice", () => {
    expect(pack(vault())).toEqual(pack(vault()));
  });

  it("says what it holds without opening all of it", () => {
    expect(manifest(pack(vault()))).toEqual({
      format: VAULT_FORMAT,
      graph: GRAPH,
      name: "The garden",
      owner: OWNER,
      notes: 2,
      media: 1,
    });
  });

  it("refuses a file that is not an archive", () => {
    expect(() => unpack(new Uint8Array([1, 2, 3]))).toThrow(VaultFormatError);
    expect(() => manifest(new Uint8Array([1, 2, 3]))).toThrow(VaultFormatError);
  });

  it("refuses an archive that names a file outside the vault", () => {
    for (const escaping of ["../../../.ssh/authorized_keys", "/etc/cron.d/x"]) {
      const held = zipSync({
        "graph.json": vault().get("graph.json") as Uint8Array,
        [escaping]: encodeText("no"),
      });
      expect(() => unpack(held)).toThrow(VaultFormatError);
      expect(() => manifest(held)).toThrow(VaultFormatError);
    }
  });

  it("reads a vault somebody zipped folders and all", () => {
    const held = vault();
    const listed: Record<string, Uint8Array> = { "notes/": new Uint8Array() };
    for (const [path, bytes] of held) listed[path] = bytes;
    expect(unpack(zipSync(listed))).toEqual(held);
  });

  it("refuses an archive with no graph in it", () => {
    const held: Vault = new Map([[notePath(NOTE), encodeText("x")]]);
    expect(() => manifest(pack(held))).toThrow(VaultFormatError);
  });
});
