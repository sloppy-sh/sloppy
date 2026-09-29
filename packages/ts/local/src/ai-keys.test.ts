import { describe, expect, it } from "vitest";
import {
  AI_KEYS_FILE,
  DeviceAiKeys,
  keyIdentifier,
  readAiKeys,
  type Sealer,
} from "./ai-keys.js";
import { MemoryFiles } from "./files.js";

/** Seals by reversing, and remembers what it was asked. */
function aSealer(): Sealer & { asked: string[]; removed: string[] } {
  const asked: string[] = [];
  const removed: string[] = [];
  return {
    asked,
    removed,
    async seal(identifier, plaintext) {
      asked.push(`seal ${identifier}`);
      return {
        sealed: [...plaintext].reverse().join(""),
        backing: "hardware",
      };
    },
    async open(identifier, sealed) {
      asked.push(`open ${identifier}`);
      return { plaintext: [...sealed].reverse().join(""), backing: "hardware" };
    },
    async remove(identifier) {
      removed.push(identifier);
      return true;
    },
  };
}

function device(): { files: MemoryFiles; sealer: ReturnType<typeof aSealer> } {
  return { files: new MemoryFiles({ root: "/device" }), sealer: aSealer() };
}

describe("the keys this device holds", () => {
  it("writes a key down sealed, and says who has one without saying what", async () => {
    const { files, sealer } = device();
    const keys = new DeviceAiKeys(files, sealer);

    expect(await keys.hold("anthropic", " sk-secret ")).toBe("hardware");

    const written = new TextDecoder().decode(
      await files.at(await files.dataPath()).read(AI_KEYS_FILE),
    );
    expect(written).not.toContain("sk-secret");
    expect(written).toContain("terces-ks");
    expect(await keys.held()).toEqual([
      { provider: "anthropic", backing: "hardware" },
    ]);
    expect(sealer.asked).toEqual([`seal ${keyIdentifier("anthropic")}`]);
  });

  it("opens the key for one act, and only then", async () => {
    const { files, sealer } = device();
    const keys = new DeviceAiKeys(files, sealer);
    await keys.hold("openai", "sk-other");

    expect(await keys.open("openai")).toBe("sk-other");
    expect(await keys.open("deepseek")).toBeUndefined();
    expect(sealer.asked.at(-1)).toBe(`open ${keyIdentifier("openai")}`);
  });

  it("replaces a provider's key, forgets one, and refuses nothing at all", async () => {
    const { files, sealer } = device();
    const keys = new DeviceAiKeys(files, sealer);
    await keys.hold("anthropic", "one");
    await keys.hold("anthropic", "two");
    await keys.hold("deepseek", "three");

    expect(await keys.open("anthropic")).toBe("two");
    await keys.forget("anthropic");
    expect((await keys.held()).map((one) => one.provider)).toEqual([
      "deepseek",
    ]);
    expect(sealer.removed).toEqual([keyIdentifier("anthropic")]);
    await expect(keys.hold("openai", "   ")).rejects.toThrow(
      "Paste the key first.",
    );
  });

  it("leaves out what it cannot read rather than losing the rest", async () => {
    const { files } = device();
    const data = files.at(await files.dataPath());
    await data.write(
      AI_KEYS_FILE,
      new TextEncoder().encode(
        JSON.stringify([
          { provider: "anthropic", sealed: "abc", backing: "system" },
          { provider: "nobody", sealed: "x", backing: "system" },
          { provider: "openai", sealed: "", backing: "hardware" },
          { provider: "deepseek", sealed: "y", backing: "magic" },
        ]),
      ),
    );
    expect(await readAiKeys(data)).toEqual([
      { provider: "anthropic", sealed: "abc", backing: "system" },
    ]);
  });
});
