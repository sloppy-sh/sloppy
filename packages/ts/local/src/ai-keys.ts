// The keys this device holds for the agents a key opens — docs/ARCHITECTURE.md
// § "Asking a tool to write the notes". A key is sealed by the device before
// it is written down and opened only for the act that sends it; a page is
// told which agents have one and never the key.

import { type ChatAgent, CHAT_AGENTS } from "@sloppy/types";
import { decodeText, encodeText } from "@sloppy/vault";
import type { Files } from "./files.js";

/** What this is called, under {@link Files.dataPath}. */
export const AI_KEYS_FILE = "ai-keys.json";

/** What kept the secret: a key that never leaves a secure element, the
 *  system's own protected store, or a key file of the app's own. */
export type SealBacking = "hardware" | "system" | "software";
export const SEAL_BACKINGS: readonly SealBacking[] = [
  "hardware",
  "system",
  "software",
];

/** What seals a secret on this device and opens it again, by the name it is
 *  kept under. `remove` answers whether there was anything to remove. */
export interface Sealer {
  seal(
    identifier: string,
    plaintext: string,
  ): Promise<{ sealed: string; backing: SealBacking }>;
  open(
    identifier: string,
    sealed: string,
  ): Promise<{ plaintext: string; backing: SealBacking }>;
  remove(identifier: string): Promise<boolean>;
}

export interface HeldKey {
  provider: ChatAgent;
  sealed: string;
  backing: SealBacking;
}

/** An agent a key is held for, and what keeps it — never the key. */
export interface KeyHeldFor {
  provider: ChatAgent;
  backing: SealBacking;
}

/** What a surface reaches the keys this device holds through. Nothing here
 *  hands a page a secret: `hold` takes one in, `held` says who has one. */
export interface AiKeysAccess {
  held(): Promise<KeyHeldFor[]>;
  hold(provider: ChatAgent, secret: string): Promise<SealBacking>;
  forget(provider: ChatAgent): Promise<void>;
}

/** The name a provider's key is sealed under. */
export function keyIdentifier(provider: ChatAgent): string {
  return `sloppy.ai.${provider}`;
}

/** `data` is rooted at {@link Files.dataPath}. An entry that cannot be read is
 *  left out rather than throwing: a key is given again in a moment. */
export async function readAiKeys(data: Files): Promise<HeldKey[]> {
  const bytes = await data.read(AI_KEYS_FILE);
  if (!bytes) return [];
  let held: unknown;
  try {
    held = JSON.parse(decodeText(bytes));
  } catch {
    return [];
  }
  if (!Array.isArray(held)) return [];
  return held.flatMap((one) => {
    const said = one as Partial<HeldKey> | null;
    if (
      !CHAT_AGENTS.includes(said?.provider as ChatAgent) ||
      typeof said?.sealed !== "string" ||
      said.sealed === "" ||
      !SEAL_BACKINGS.includes(said.backing as SealBacking)
    )
      return [];
    return [
      {
        provider: said.provider as ChatAgent,
        sealed: said.sealed,
        backing: said.backing as SealBacking,
      },
    ];
  });
}

export async function writeAiKeys(
  data: Files,
  held: readonly HeldKey[],
): Promise<void> {
  await data.write(
    AI_KEYS_FILE,
    encodeText(`${JSON.stringify(held, null, 2)}\n`),
  );
}

export class DeviceAiKeys implements AiKeysAccess {
  constructor(
    private readonly files: Files,
    private readonly sealer: Sealer,
  ) {}

  async held(): Promise<KeyHeldFor[]> {
    const held = await readAiKeys(await this.data());
    return held.map(({ provider, backing }) => ({ provider, backing }));
  }

  async hold(provider: ChatAgent, secret: string): Promise<SealBacking> {
    const given = secret.trim();
    if (given === "") throw new Error("Paste the key first.");
    const data = await this.data();
    const { sealed, backing } = await this.sealer.seal(
      keyIdentifier(provider),
      given,
    );
    const others = (await readAiKeys(data)).filter(
      (one) => one.provider !== provider,
    );
    await writeAiKeys(data, [...others, { provider, sealed, backing }]);
    return backing;
  }

  async forget(provider: ChatAgent): Promise<void> {
    const data = await this.data();
    const held = await readAiKeys(data);
    await writeAiKeys(
      data,
      held.filter((one) => one.provider !== provider),
    );
    await this.sealer.remove(keyIdentifier(provider)).catch(() => false);
  }

  /** The key itself, opened for one act. Not on {@link AiKeysAccess}: a page
   *  is never handed this. */
  async open(provider: ChatAgent): Promise<string | undefined> {
    const held = (await readAiKeys(await this.data())).find(
      (one) => one.provider === provider,
    );
    if (!held) return undefined;
    const { plaintext } = await this.sealer.open(
      keyIdentifier(provider),
      held.sealed,
    );
    return plaintext;
  }

  private async data(): Promise<Files> {
    return this.files.at(await this.files.dataPath());
  }
}
