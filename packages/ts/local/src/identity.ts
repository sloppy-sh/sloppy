// The identity a graph on this device belongs to —
// docs/ARCHITECTURE.md § "Local-only mode".

import {
  decodePrivateKey,
  deriveDid,
  encodePrivateKey,
  encodePublicKey,
  generateKeypair,
  publicKeyFromPrivateKey,
  wipe,
} from "@sloppy/idp/crypto";
import { type DidSyr, DidSyrSchema } from "@sloppy/types";
import { decodeText, encodeText } from "@sloppy/vault";
import type { Files } from "./files.js";

/** What `identity.json` is called, under {@link Files.dataPath}. */
export const IDENTITY_FILE = "identity.json";
/** What the file that {@link LocalIdentity.seed} points at is called, unless a
 *  file already there says otherwise. */
export const SEED_FILE = "identity.key";

/**
 * Who owns the graphs written on this device. The key itself is NOT here: it is
 * in the file {@link seed} names, so anything that reads, copies or shows an
 * identity carries no secret with it.
 */
export interface LocalIdentity {
  did: DidSyr;
  /** Multibase, the same key `did` spells — carried so a reader has it without
   *  decoding the DID. */
  public_key: string;
  /** The file the private key is in, relative to {@link Files.dataPath}. */
  seed: string;
}

/** An identity that has never been written down, and the key that goes with it.
 *  `key` is a 32-byte seed; hand it to {@link writeLocalIdentity} and let go. */
export interface MintedIdentity {
  identity: LocalIdentity;
  key: Uint8Array;
}

export function makeLocalIdentity(): MintedIdentity {
  const keypair = generateKeypair();
  return {
    identity: {
      did: DidSyrSchema.parse(deriveDid(keypair.publicKey)),
      public_key: encodePublicKey(keypair.publicKey),
      seed: SEED_FILE,
    },
    key: keypair.privateKey,
  };
}

/**
 * A file this device kept an identity in that can no longer be read as one.
 * It is an error rather than a fresh start on purpose: the graphs already
 * written here belong to the identity in that file, and minting a second one
 * over it would orphan every one of them. `message` is fit to show somebody.
 */
export class LocalIdentityError extends Error {
  constructor() {
    super(
      "This device's identity could not be read, so nothing can be written under it.",
    );
    this.name = "LocalIdentityError";
  }
}

/** `undefined` where this device has no identity yet, which is the ordinary
 *  first run. A file that is there and is not one throws. */
export async function readLocalIdentity(
  files: Files,
): Promise<LocalIdentity | undefined> {
  const own = files.at(await files.dataPath());
  const bytes = await own.read(IDENTITY_FILE);
  if (!bytes) return undefined;
  let held: unknown;
  try {
    held = JSON.parse(decodeText(bytes));
  } catch {
    throw new LocalIdentityError();
  }
  const said = held as Partial<LocalIdentity> | null;
  const did = DidSyrSchema.safeParse(said?.did);
  if (!said || !did.success || typeof said.public_key !== "string") {
    throw new LocalIdentityError();
  }
  return {
    did: did.data,
    public_key: said.public_key,
    seed: typeof said.seed === "string" && said.seed ? said.seed : SEED_FILE,
  };
}

/**
 * Write both halves down. The key goes in plain, because this folder is the
 * app's own private storage: a password over it would only guard against
 * somebody who already reads the folder, and there is nobody to ask for one.
 *
 * `key` is zeroed on the way out, so a caller that keeps the {@link
 * MintedIdentity} around is not still holding a seed.
 */
export async function writeLocalIdentity(
  files: Files,
  made: MintedIdentity,
): Promise<LocalIdentity> {
  const own = files.at(await files.dataPath());
  try {
    await own.write(made.identity.seed, encodeText(encodePrivateKey(made.key)));
    await own.write(
      IDENTITY_FILE,
      encodeText(`${JSON.stringify(made.identity, null, 2)}\n`),
    );
  } finally {
    wipe(made.key);
  }
  return made.identity;
}

/** The private key this identity signs with, or `undefined` where the file it
 *  names is gone or is not a key — an identity nothing can be signed under. */
export async function readLocalKey(
  files: Files,
  identity: LocalIdentity,
): Promise<Uint8Array | undefined> {
  const own = files.at(await files.dataPath());
  const bytes = await own.read(identity.seed);
  if (!bytes) return undefined;
  let key: Uint8Array;
  try {
    key = decodePrivateKey(decodeText(bytes).trim());
  } catch {
    return undefined;
  }
  const spelled = encodePublicKey(publicKeyFromPrivateKey(key));
  if (spelled !== identity.public_key) {
    wipe(key);
    return undefined;
  }
  return key;
}

/** The identity this device writes under, made on the spot the first time.
 *  This is the whole of "no sign-in": nothing here asks anybody anything. */
export async function openLocalIdentity(files: Files): Promise<LocalIdentity> {
  return (
    (await readLocalIdentity(files)) ??
    (await writeLocalIdentity(files, makeLocalIdentity()))
  );
}
