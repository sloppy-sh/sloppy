// Reading a key block, and keeping the keys in it that speak for one address.
// docs/ARCHITECTURE.md § "Who a person is".

import type { BoundKey } from "@sloppy/types";
import { type Key, readKeys } from "openpgp";

const ARMOUR = "-----BEGIN PGP PUBLIC KEY BLOCK-----";

/**
 * The keys in one block that speak for this address right now: one carrying a
 * user ID that names it, whose primary key is neither revoked nor expired.
 *
 * A block that holds none of those is an empty list — an answer, and never the
 * same as nobody having answered. `from` is where the block was read, which is
 * what a `Vouch` records as its instance.
 */
export async function keysSpeakingFor(
  block: Uint8Array,
  address: string,
  from: string,
): Promise<readonly BoundKey[]> {
  const read = await readBlock(block);
  const speaking = await Promise.all(
    read.map(async (key) => ((await speaksFor(key, address)) ? key : null)),
  );
  return speaking
    .filter((key): key is Key => key !== null)
    .map((key) => ({
      scheme: "openpgp",
      key: key.toPublic().armor(),
      signs: "content",
      from,
    }));
}

async function readBlock(block: Uint8Array): Promise<readonly Key[]> {
  const asText = new TextDecoder().decode(block);
  try {
    return asText.includes(ARMOUR)
      ? await readKeys({ armoredKeys: asText })
      : await readKeys({ binaryKeys: block });
  } catch {
    return [];
  }
}

async function speaksFor(key: Key, address: string): Promise<boolean> {
  // A user ID is spelled however its holder wrote it, and openpgp matches one
  // byte for byte — so the address is matched loosely and then verified under
  // the spelling the key itself carries.
  const spelledAs = key.users
    .map((user) => user.userID?.email)
    .find((email) => email?.toLowerCase() === address);
  if (spelledAs === undefined) return false;
  try {
    await key.verifyPrimaryKey(undefined, { email: spelledAs });
    return true;
  } catch {
    return false;
  }
}

/**
 * What names this key whatever it was spelled as: the primary key's
 * fingerprint, lowercase hex.
 *
 * Two blocks holding one key — armoured or binary, with a different set of user
 * IDs or signatures around it — give the same answer, which is what makes this
 * the honest way to ask whether a key somebody holds is the key a signature was
 * made with. `null` is bytes no key could be read out of.
 */
export async function openPgpFingerprint(
  key: string | Uint8Array,
): Promise<string | null> {
  try {
    const read =
      typeof key === "string"
        ? await readKeys({ armoredKeys: key })
        : await readKeys({ binaryKeys: key });
    return read[0]?.getFingerprint() ?? null;
  } catch {
    return null;
  }
}
