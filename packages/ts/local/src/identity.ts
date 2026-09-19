// The identities this device holds, and which of them a write here carries —
// docs/ARCHITECTURE.md § "A graph off the device".

import {
  decodePrivateKey,
  decodePublicKey,
  deriveDid,
  encodePrivateKey,
  encodePublicKey,
  generateKeypair,
  openSigil,
  publicKeyFromDid,
  publicKeyFromPrivateKey,
  readSigil,
  type Sigil,
  SigilDecryptionError,
  sigilDid,
  wipe,
} from "@sloppy/idp/crypto";
import {
  type DidSyr,
  DidSyrSchema,
  type IdentitySource,
  IdentitySourceSchema,
  nowIso,
} from "@sloppy/types";
import { decodeText, encodeText } from "@sloppy/vault";
import {
  consentUrl,
  exchangeCode,
  type Fetching,
  normalizeInstanceUrl,
  readPicture,
  readProfile,
} from "./delegation.js";
import type { Files } from "./files.js";
import { refuse } from "./refusal.js";

/** What the list is called, under {@link Files.dataPath}. */
export const IDENTITIES_FILE = "identities.json";
/** The lone identity a device kept before the list, read once and written into
 *  it. */
export const IDENTITY_FILE = "identity.json";
/** What the first identity made here calls its key file. */
export const SEED_FILE = "identity.key";

/**
 * Who a graph on this device is written under. The key is never here: an
 * identity made on this device names the file it is in, and a delegated one has
 * none on this device at all.
 */
export interface LocalIdentity {
  did: DidSyr;
  /** Multibase, the same key `did` spells — carried so a reader has it without
   *  decoding the DID. */
  public_key: string;
}

/** An identity made here, with its key in a file in this app's private data. */
export interface DeviceIdentity extends LocalIdentity {
  source: "device";
  /** The file the private key is in, relative to {@link Files.dataPath}. */
  seed: string;
}

/**
 * An identity whose key is on this device and shut under a passphrase this
 * device does not keep. It names whose graph a note is in the moment it
 * arrives; the key comes out only for an act that must sign with it, and goes
 * again straight after.
 */
export interface SealedIdentity extends LocalIdentity {
  source: "sealed";
  /** The file the sealed key is in, relative to {@link Files.dataPath}, kept
   *  as it arrived. */
  sealed: string;
  /** What is known to call them. Absent where nothing said — a sealed key
   *  carries no name of its own. */
  name?: string;
}

/**
 * An identity an identity store somewhere else keeps and signs for. Nothing of
 * the key is on this device — AI.md § "Sloppy's Vocabulary Stays Out of the
 * Identity Store".
 */
export interface DelegatedIdentity extends LocalIdentity {
  source: "delegated";
  instance_url: string;
  delegate_public_key: string;
  access_token: string;
  /** When the store stops standing behind the token. Absent where it did not
   *  say, which is not the same as never. */
  expires_at?: string;
  /** What the store called them when this device last asked. Absent where it
   *  says nothing. */
  name?: string;
  /** What the store had them wearing when this device last asked: the file it
   *  is in under {@link Files.dataPath}, and what kind of picture it is.
   *  Absent where they have none. */
  picture?: { file: string; mime_type: string };
}

/** One of the identities this device holds. {@link IdentitySource} is the axis:
 *  a second kind of store is another arm here, never a field beside one. */
export type HeldIdentity = DeviceIdentity | SealedIdentity | DelegatedIdentity;

/** Every identity this device holds, and which of them writes where a graph's
 *  own owner is not among them. `writing` naming nobody held is read as
 *  absent. */
export interface HeldIdentities {
  identities: HeldIdentity[];
  writing?: DidSyr;
}

/** An identity that has never been written down, and the key that goes with it.
 *  `key` is a 32-byte seed; hand it to {@link holdDeviceIdentity} and let go. */
export interface MintedIdentity {
  identity: DeviceIdentity;
  key: Uint8Array;
}

/** A key file per identity, so a second one made here does not land on the
 *  first one's. Multibase spells the public key in letters and digits only. */
function seedFor(publicKey: string): string {
  return `${publicKey}.key`;
}

/** Where a key that arrived shut is kept, beside the ones made here and named
 *  the same way. */
function sealedFor(publicKey: string): string {
  return `${publicKey}.sigil`;
}

/** A sealed key's public key, spelled the way every identity here spells one —
 *  a Sigil may carry the raw key where this device writes the prefixed one. */
function sealedPublicKey(sigil: Sigil): string {
  return encodePublicKey(decodePublicKey(sigil.pub));
}

/** Where the picture a store has one identity wearing is kept, beside its key
 *  and named the same way. */
function pictureFor(publicKey: string): string {
  return `${publicKey}.picture`;
}

/**
 * What a store said an identity this device holds is called and wearing, as
 * this device last heard it. A graph started under that identity is written in
 * with it, so a folder started long after the sign-in still says whose it is.
 */
export interface HeldProfile {
  name?: string;
  picture?: { bytes: Uint8Array; mime_type: string };
}

export async function readHeldProfile(
  files: Files,
  did: DidSyr,
): Promise<HeldProfile> {
  const held = (await readIdentities(files)).identities.find(
    (one) => one.did === did,
  );
  if (held?.source !== "delegated") return {};
  const kept = held.picture;
  const bytes = kept
    ? await files.at(await files.dataPath()).read(kept.file)
    : undefined;
  return {
    ...(held.name === undefined ? {} : { name: held.name }),
    ...(kept && bytes ? { picture: { bytes, mime_type: kept.mime_type } } : {}),
  };
}

export function makeLocalIdentity(): MintedIdentity {
  const keypair = generateKeypair();
  const publicKey = encodePublicKey(keypair.publicKey);
  return {
    identity: {
      did: DidSyrSchema.parse(deriveDid(keypair.publicKey)),
      public_key: publicKey,
      source: "device",
      seed: seedFor(publicKey),
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

function readJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(decodeText(bytes));
  } catch {
    throw new LocalIdentityError();
  }
}

function readHeld(said: unknown): HeldIdentity | undefined {
  const one = said as Record<string, unknown> | null;
  const did = DidSyrSchema.safeParse(one?.did);
  if (!one || !did.success || typeof one.public_key !== "string") {
    return undefined;
  }
  const source: IdentitySource =
    IdentitySourceSchema.safeParse(one.source).data ?? "device";
  if (source === "delegated") {
    if (
      typeof one.instance_url !== "string" ||
      typeof one.delegate_public_key !== "string" ||
      typeof one.access_token !== "string"
    ) {
      return undefined;
    }
    const wearing = one.picture as Partial<DelegatedIdentity["picture"]>;
    const picture =
      typeof wearing?.file === "string" && typeof wearing.mime_type === "string"
        ? { file: wearing.file, mime_type: wearing.mime_type }
        : undefined;
    return {
      did: did.data,
      public_key: one.public_key,
      source: "delegated",
      instance_url: one.instance_url,
      delegate_public_key: one.delegate_public_key,
      access_token: one.access_token,
      ...(typeof one.expires_at === "string"
        ? { expires_at: one.expires_at }
        : {}),
      ...(typeof one.name === "string" && one.name !== ""
        ? { name: one.name }
        : {}),
      ...(picture === undefined ? {} : { picture }),
    };
  }
  if (source === "sealed") {
    if (typeof one.sealed !== "string" || !one.sealed) return undefined;
    return {
      did: did.data,
      public_key: one.public_key,
      source: "sealed",
      sealed: one.sealed,
      ...(typeof one.name === "string" && one.name !== ""
        ? { name: one.name }
        : {}),
    };
  }
  return {
    did: did.data,
    public_key: one.public_key,
    source: "device",
    seed: typeof one.seed === "string" && one.seed ? one.seed : SEED_FILE,
  };
}

/**
 * Every identity this device holds. An empty list is the ordinary first run; a
 * file that is there and cannot be read as identities throws, because the
 * graphs here belong to whoever is in it.
 */
export async function readIdentities(files: Files): Promise<HeldIdentities> {
  const own = files.at(await files.dataPath());
  const bytes = await own.read(IDENTITIES_FILE);
  if (!bytes) return migrate(files);
  const said = readJson(bytes) as Partial<HeldIdentities> | null;
  if (!said || !Array.isArray(said.identities)) throw new LocalIdentityError();
  const identities: HeldIdentity[] = [];
  for (const one of said.identities) {
    const held = readHeld(one);
    if (!held) throw new LocalIdentityError();
    identities.push(held);
  }
  const writing = DidSyrSchema.safeParse(said.writing);
  return {
    identities,
    ...(writing.success && identities.some((one) => one.did === writing.data)
      ? { writing: writing.data }
      : {}),
  };
}

/** The lone identity a device kept before the list, written into one. */
async function migrate(files: Files): Promise<HeldIdentities> {
  const own = files.at(await files.dataPath());
  const bytes = await own.read(IDENTITY_FILE);
  if (!bytes) return { identities: [] };
  const held = readHeld(readJson(bytes));
  if (!held) throw new LocalIdentityError();
  const now = { identities: [held], writing: held.did };
  await writeIdentities(files, now);
  await own.remove(IDENTITY_FILE);
  return now;
}

export async function writeIdentities(
  files: Files,
  held: HeldIdentities,
): Promise<void> {
  const own = files.at(await files.dataPath());
  await own.write(
    IDENTITIES_FILE,
    encodeText(`${JSON.stringify(held, null, 2)}\n`),
  );
}

/**
 * Hold an identity made here. The key goes in plain, because this folder is the
 * app's own private storage: a password over it would only guard against
 * somebody who already reads the folder, and there is nobody to ask for one.
 *
 * `key` is zeroed on the way out, so a caller that keeps the {@link
 * MintedIdentity} around is not still holding a seed.
 */
export async function holdDeviceIdentity(
  files: Files,
  made: MintedIdentity,
  { writing = true }: { writing?: boolean } = {},
): Promise<DeviceIdentity> {
  const own = files.at(await files.dataPath());
  const held = await readIdentities(files);
  try {
    await own.write(made.identity.seed, encodeText(encodePrivateKey(made.key)));
    await writeIdentities(files, {
      identities: [
        ...held.identities.filter((one) => one.did !== made.identity.did),
        made.identity,
      ],
      ...(writing || held.writing === undefined
        ? { writing: made.identity.did }
        : { writing: held.writing }),
    });
  } finally {
    wipe(made.key);
  }
  return made.identity;
}

/** Hold an identity a store somewhere else keeps, replacing what this device
 *  held of it before. */
export async function holdDelegatedIdentity(
  files: Files,
  identity: DelegatedIdentity,
): Promise<DelegatedIdentity> {
  const held = await readIdentities(files);
  await writeIdentities(files, {
    identities: [
      ...held.identities.filter((one) => one.did !== identity.did),
      identity,
    ],
    writing: identity.did,
  });
  return identity;
}

/** A key that arrived shut, and the file it arrived in. The file is kept byte
 *  for byte: what seals it is the person's, and re-sealing it here would put
 *  this device between them and their own key. */
export interface BroughtSealed {
  identity: SealedIdentity;
  file: Uint8Array;
}

/**
 * The identity in a sealed file, read without asking anybody for anything: the
 * public key is on the outside of it, and that is the whole of what a DID and a
 * row on screen need.
 */
export function readSealedIdentity(bytes: Uint8Array): BroughtSealed {
  const notOne = refuse(
    "That file does not hold an identity Sloppy can write under.",
  );
  let sigil: Sigil;
  try {
    sigil = readSigil(bytes);
  } catch {
    throw notOne;
  }
  const did = DidSyrSchema.safeParse(sigilDid(sigil));
  if (!did.success) throw notOne;
  const publicKey = sealedPublicKey(sigil);
  return {
    identity: {
      did: did.data,
      public_key: publicKey,
      source: "sealed",
      sealed: sealedFor(publicKey),
    },
    file: bytes,
  };
}

/** Hold a key this device cannot use without the person, replacing what it
 *  held of that identity before. */
export async function holdSealedIdentity(
  files: Files,
  brought: BroughtSealed,
): Promise<SealedIdentity> {
  const own = files.at(await files.dataPath());
  const held = await readIdentities(files);
  await own.write(brought.identity.sealed, brought.file);
  await writeIdentities(files, {
    identities: [
      ...held.identities.filter((one) => one.did !== brought.identity.did),
      brought.identity,
    ],
    writing: brought.identity.did,
  });
  return brought.identity;
}

/**
 * Run `act` with the key a sealed identity is shut under, and wipe it on the
 * way out. The passphrase belongs to this one act: the seed is never written
 * down, and it does not outlive `act` even where `act` throws.
 */
export async function withSealedKey<T>(
  files: Files,
  identity: SealedIdentity,
  passphrase: string,
  act: (key: Uint8Array) => T | Promise<T>,
): Promise<T> {
  const own = files.at(await files.dataPath());
  const bytes = await own.read(identity.sealed);
  if (!bytes) {
    throw refuse("The key for that identity is not on this device any more.");
  }
  const unreadable = refuse(
    "The key for that identity could not be read. Bring the identity in again.",
  );
  let sigil: Sigil;
  try {
    sigil = readSigil(bytes);
  } catch {
    throw unreadable;
  }
  if (sealedPublicKey(sigil) !== identity.public_key) throw unreadable;
  let seed: Uint8Array;
  try {
    seed = await openSigil(sigil, passphrase);
  } catch (err) {
    if (err instanceof SigilDecryptionError) {
      throw refuse("That passphrase did not open it. Try it again.");
    }
    throw err;
  }
  try {
    return await act(seed);
  } finally {
    wipe(seed);
  }
}

/** Write under this one from now on, where a graph's own owner is not held
 *  here. */
export async function writeAs(files: Files, did: DidSyr): Promise<void> {
  const held = await readIdentities(files);
  if (!held.identities.some((one) => one.did === did)) {
    throw new LocalIdentityError();
  }
  await writeIdentities(files, { ...held, writing: did });
}

/** The private key this identity signs with, or `undefined` where the file it
 *  names is gone or is not a key — an identity nothing can be signed under. */
export async function readLocalKey(
  files: Files,
  identity: DeviceIdentity,
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

/**
 * Which identity a write in a graph carries: the graph's own owner where this
 * device holds it, and otherwise the one chosen to write under. `undefined` is
 * a device holding none yet.
 */
export function whoWrites(
  held: HeldIdentities,
  owner?: DidSyr,
): DidSyr | undefined {
  if (owner !== undefined && held.identities.some((one) => one.did === owner)) {
    return owner;
  }
  return held.writing ?? held.identities[0]?.did;
}

/** An identity known by its DID alone — a graph's owner that this device does
 *  not hold, which it still reads and renders under. */
export function identityOf(did: DidSyr): LocalIdentity {
  return { did, public_key: encodePublicKey(publicKeyFromDid(did)) };
}

/**
 * The identity a write here carries. `writing` names one; absent is the one
 * this device writes under by default, made on the spot the first time and
 * asking nobody anything.
 */
export async function openLocalIdentity(
  files: Files,
  writing?: DidSyr,
): Promise<LocalIdentity> {
  const held = await readIdentities(files);
  const wanted = writing ?? whoWrites(held);
  const one = held.identities.find((held) => held.did === wanted);
  if (one) return one;
  if (wanted !== undefined) return identityOf(wanted);
  return holdDeviceIdentity(files, makeLocalIdentity());
}

// ── An identity carried between devices ────────────────────────────────────

/** What a device writes so another device can write as the same person. It
 *  holds the key, which is what the offer of one says out loud. */
interface CarriedIdentity {
  sloppy_identity: 1;
  did: DidSyr;
  public_key: string;
  /** Multibase, the same encoding the key file uses. */
  key: string;
}

/** What a file carrying an identity is called on the way out. */
export const CARRIED_FILE = "sloppy-identity.json";

const CARRIED_NAME = "sloppy-identity";

/** Whether a path is a copy of an identity saved out of the app: {@link
 *  CARRIED_FILE}, and whatever a save panel numbered or unsuffixed beside it.
 *  Such a file holds the key, so one left in a graph's folder is still the
 *  person's own and never the vault's — no copy of the graph carries it. */
export function carriedIdentityFile(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return (
    name === CARRIED_NAME ||
    (name.startsWith(CARRIED_NAME) && name.endsWith(".json"))
  );
}

export function carryIdentityOut(
  identity: LocalIdentity,
  key: Uint8Array,
): Uint8Array {
  const carried: CarriedIdentity = {
    sloppy_identity: 1,
    did: identity.did,
    public_key: identity.public_key,
    key: encodePrivateKey(key),
  };
  return encodeText(`${JSON.stringify(carried, null, 2)}\n`);
}

/** The identity in a file another device wrote, checked against its own key.
 *  The key is the caller's to let go of — {@link holdDeviceIdentity} does. */
export function readCarriedIdentity(bytes: Uint8Array): MintedIdentity {
  const notOne = refuse(
    "That file does not hold an identity Sloppy can write under.",
  );
  let said: Partial<CarriedIdentity> | null;
  try {
    said = JSON.parse(decodeText(bytes)) as Partial<CarriedIdentity> | null;
  } catch {
    throw notOne;
  }
  if (!said || typeof said.key !== "string") throw notOne;
  let key: Uint8Array;
  try {
    key = decodePrivateKey(said.key.trim());
  } catch {
    throw notOne;
  }
  const publicKey = publicKeyFromPrivateKey(key);
  const spelled = encodePublicKey(publicKey);
  const did = DidSyrSchema.safeParse(deriveDid(publicKey));
  if (!did.success || (said.did !== undefined && said.did !== did.data)) {
    wipe(key);
    throw notOne;
  }
  return {
    identity: {
      did: did.data,
      public_key: spelled,
      source: "device",
      seed: seedFor(spelled),
    },
    key,
  };
}

// ── The three doors, as a surface reaches them ─────────────────────────────

/** One identity this device holds, as a person is shown it. */
export interface IdentityHere {
  did: DidSyr;
  source: IdentitySource;
  /** What is known to call them. Absent where nothing says. */
  name?: string;
  /** The host of the store that keeps it, for one kept somewhere else. */
  instance?: string;
  /** Whether the key is here but shut, so an act that needs it asks the person
   *  for the passphrase first. */
  locked: boolean;
  /** Whether the store's word for it has run out, so the name and the picture
   *  stop refreshing until somebody signs in again. The DID is a fact either
   *  way, so the identity stays held. */
  lapsed: boolean;
  /** Whether a write in the graph in front of somebody carries this one. */
  writing: boolean;
  /** Whether this device has the key, so the identity can be carried to
   *  another device. */
  carriable: boolean;
}

/** What a sign-in settled: which identity writes here, and what the store that
 *  keeps it says the person is called and wearing. */
export interface SignedIn {
  identity: IdentityHere;
  name?: string;
  picture?: { bytes: Uint8Array; type: string };
}

/**
 * The identities on this device, and the three ways one arrives. A shell hands
 * this to `@sloppy/app-core`'s runtime, so no surface spells a platform's way
 * of making, fetching or carrying one.
 */
export interface IdentityAccess {
  list(): Promise<IdentityHere[]>;
  /** Make one here, with nothing asked of anybody. */
  makeOne(): Promise<IdentityHere>;
  /** Take somebody to their store to approve this app. What comes back lands
   *  on {@link finish}. */
  signIn(instance: string): Promise<void>;
  /** Finish what a store sent back. `undefined` where this is not a return
   *  from one, so a shell may ask it of every launch. */
  finish(query: URLSearchParams): Promise<SignedIn | undefined>;
  /** Hold the identity in a file another device wrote. */
  bring(file: Uint8Array): Promise<IdentityHere>;
  /** Hold the identity in a sealed file a person brought, exactly as it
   *  arrived. Nothing is asked of them here: what the row shows is on the
   *  outside of it. */
  bringSealed(file: Uint8Array): Promise<IdentityHere>;
  /** The file that carries one to another device. A sealed identity needs the
   *  passphrase it is sealed under; every other one ignores it. */
  carryOut(
    did: DidSyr,
    passphrase?: string,
  ): Promise<{ name: string; body: Uint8Array }>;
  /** Write under this one from now on. */
  writeAs(did: DidSyr): Promise<void>;
}

/** Where a sign-in that has left for a store is written down, under
 *  {@link Files.dataPath}. */
const SIGNING_IN_FILE = "signing-in.json";
/** How long somebody has to decide at their store before what comes back is
 *  read as an answer to a question nobody here asked. */
const CONSENT_TTL_MS = 10 * 60 * 1000;

interface SigningIn {
  state: string;
  instance_url: string;
  at: string;
}

function nonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function shown(identity: HeldIdentity, writing: boolean): IdentityHere {
  const delegated = identity.source === "delegated" ? identity : undefined;
  const named = identity.source === "device" ? undefined : identity.name;
  return {
    did: identity.did,
    source: identity.source,
    ...(named === undefined ? {} : { name: named }),
    ...(delegated === undefined
      ? {}
      : { instance: hostOf(delegated.instance_url) }),
    locked: identity.source === "sealed",
    lapsed:
      delegated?.expires_at !== undefined &&
      Date.parse(delegated.expires_at) <= Date.now(),
    writing,
    carriable: identity.source !== "delegated",
  };
}

export interface IdentitiesOptions {
  /** How this app reaches an identity store. A webview's own fetch is bounded
   *  by where the page came from, so a shell supplies one that is not. */
  fetching: Fetching;
  /** This app's own public web origin — where a store is told to send somebody
   *  back, and the origin it is asked to delegate to. */
  origin: string;
  /** Take somebody to a page outside the app. */
  leave(url: string): Promise<void> | void;
  /** Who owns the graph in front of somebody, so a folder of their own is
   *  written in as its owner. Absent is a device with no graph open. */
  graphOwner?(): DidSyr | undefined;
  /** Called whenever which identity writes here changes, and awaited: what
   *  serves the graph is re-pointed before the caller is told it is done. */
  changed?(): Promise<void> | void;
}

/** {@link IdentityAccess} over this device's private data. */
export class Identities implements IdentityAccess {
  constructor(
    private readonly files: Files,
    private readonly options: IdentitiesOptions,
  ) {}

  /** syr compares this to the exchange's byte for byte, so one value spells
   *  both and it carries no query of its own. */
  private get callbackUrl(): string {
    return `${this.options.origin.replace(/\/+$/, "")}/auth/return`;
  }

  async list(): Promise<IdentityHere[]> {
    const held = await readIdentities(this.files);
    const writing = whoWrites(held, this.options.graphOwner?.());
    return held.identities.map((one) => shown(one, one.did === writing));
  }

  async makeOne(): Promise<IdentityHere> {
    const made = await holdDeviceIdentity(this.files, makeLocalIdentity());
    await this.options.changed?.();
    return shown(made, true);
  }

  async signIn(instance: string): Promise<void> {
    const instanceUrl = normalizeInstanceUrl(instance);
    const state = nonce();
    const url = await consentUrl(
      instanceUrl,
      {
        platform_origin: this.options.origin,
        platform_name: "Sloppy",
        callback_url: this.callbackUrl,
        state,
      },
      this.options.fetching,
    );
    await this.hold({ state, instance_url: instanceUrl, at: nowIso() });
    await this.options.leave(url);
  }

  async finish(query: URLSearchParams): Promise<SignedIn | undefined> {
    const state = query.get("state");
    if (!state) return undefined;
    const asked = await this.asked();
    if (!asked || asked.state !== state) return undefined;
    await this.hold(undefined);
    if (Date.now() - Date.parse(asked.at) > CONSENT_TTL_MS) {
      throw refuse("Sign-in took too long. Start again.");
    }
    if (query.get("error")) {
      throw refuse("Sloppy was not approved, so you are not signed in.");
    }
    const code = query.get("code");
    const delegationId = query.get("delegation_id");
    if (!code || !delegationId) {
      throw refuse("Sign-in did not finish. Start again from Sloppy.");
    }

    const opened = await exchangeCode(
      asked.instance_url,
      {
        code,
        delegation_id: delegationId,
        callback_url: this.callbackUrl,
        platform_origin: this.options.origin,
      },
      this.options.fetching,
    );
    const profile = await readProfile(
      asked.instance_url,
      opened.did,
      this.options.fetching,
    ).catch(() => undefined);
    const name = profile?.display_name?.trim() || undefined;
    const publicKey = encodePublicKey(publicKeyFromDid(opened.did));
    const picture = profile?.avatar_url
      ? await readPicture(profile.avatar_url, this.options.fetching)
      : undefined;
    const kept = picture
      ? await this.keepPicture(publicKey, picture)
      : undefined;
    const identity = await holdDelegatedIdentity(this.files, {
      did: opened.did,
      public_key: publicKey,
      source: "delegated",
      instance_url: asked.instance_url,
      delegate_public_key: opened.delegate_public_key,
      access_token: opened.access_token,
      expires_at: new Date(Date.now() + opened.expires_in * 1000).toISOString(),
      ...(name === undefined ? {} : { name }),
      ...(kept === undefined ? {} : { picture: kept }),
    });
    await this.options.changed?.();
    return {
      identity: shown(identity, true),
      ...(name === undefined ? {} : { name }),
      ...(picture === undefined ? {} : { picture }),
    };
  }

  async bring(file: Uint8Array): Promise<IdentityHere> {
    const made = await holdDeviceIdentity(
      this.files,
      readCarriedIdentity(file),
    );
    await this.options.changed?.();
    return shown(made, true);
  }

  async bringSealed(file: Uint8Array): Promise<IdentityHere> {
    const held = await holdSealedIdentity(this.files, readSealedIdentity(file));
    await this.options.changed?.();
    return shown(held, true);
  }

  async carryOut(
    did: DidSyr,
    passphrase?: string,
  ): Promise<{ name: string; body: Uint8Array }> {
    const held = await readIdentities(this.files);
    const one = held.identities.find((identity) => identity.did === did);
    if (one?.source === "sealed") return this.carrySealedOut(one, passphrase);
    if (!one || one.source !== "device") {
      throw refuse(
        "That identity is kept for you somewhere else, so there is no file of it to carry.",
      );
    }
    const key = await readLocalKey(this.files, one);
    if (!key) {
      throw refuse("The key for that identity is not on this device any more.");
    }
    try {
      return { name: CARRIED_FILE, body: carryIdentityOut(one, key) };
    } finally {
      wipe(key);
    }
  }

  async writeAs(did: DidSyr): Promise<void> {
    await writeAs(this.files, did);
    await this.options.changed?.();
  }

  private async carrySealedOut(
    one: SealedIdentity,
    passphrase?: string,
  ): Promise<{ name: string; body: Uint8Array }> {
    if (!passphrase) {
      throw refuse(
        "That identity is kept shut. Type the passphrase it was sealed with to carry it out.",
      );
    }
    return withSealedKey(this.files, one, passphrase, (key) => ({
      name: CARRIED_FILE,
      body: carryIdentityOut(one, key),
    }));
  }

  /** The picture kept where a graph started later can still be written with
   *  it. Answers absent where it could not be written, which costs a face and
   *  nothing else. */
  private async keepPicture(
    publicKey: string,
    picture: { bytes: Uint8Array; type: string },
  ): Promise<DelegatedIdentity["picture"]> {
    const file = pictureFor(publicKey);
    try {
      await this.files
        .at(await this.files.dataPath())
        .write(file, picture.bytes);
    } catch {
      return undefined;
    }
    return { file, mime_type: picture.type };
  }

  private async asked(): Promise<SigningIn | undefined> {
    const own = this.files.at(await this.files.dataPath());
    const bytes = await own.read(SIGNING_IN_FILE);
    if (!bytes) return undefined;
    try {
      const said = JSON.parse(decodeText(bytes)) as Partial<SigningIn> | null;
      if (
        typeof said?.state !== "string" ||
        typeof said.instance_url !== "string" ||
        typeof said.at !== "string"
      ) {
        return undefined;
      }
      return {
        state: said.state,
        instance_url: said.instance_url,
        at: said.at,
      };
    } catch {
      return undefined;
    }
  }

  private async hold(asked: SigningIn | undefined): Promise<void> {
    const own = this.files.at(await this.files.dataPath());
    if (!asked) {
      await own.remove(SIGNING_IN_FILE);
      return;
    }
    await own.write(
      SIGNING_IN_FILE,
      encodeText(`${JSON.stringify(asked, null, 2)}\n`),
    );
  }
}
