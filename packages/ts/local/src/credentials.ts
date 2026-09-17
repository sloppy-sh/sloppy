// What this device was given to reach the hosts a person keeps their folders
// on — docs/ARCHITECTURE.md § "The vault's history".

import { decodeText, encodeText } from "@sloppy/vault";
import type { Files } from "./files.js";
import type { Credential } from "./history.js";
import { readSshKey } from "./git-defaults.js";

/** What this is called, under {@link Files.dataPath}. */
export const CREDENTIALS_FILE = "credentials.json";

/** One host and what it takes. `host` is a bare host name — a person sets one
 *  up once and every folder they keep there is reached with it. */
export interface HeldCredential {
  host: string;
  credential: Credential;
}

/**
 * The host a remote is at, lowercased, for both spellings of an address:
 * `https://host/…` and `user@host:…`. `undefined` is an address with no host
 * in it — a folder somewhere else on this same device — which nothing is ever
 * matched to.
 */
export function remoteHost(url: string): string | undefined {
  const said = url.trim();
  const shorthand = /^[^\s/@]+@([^\s/:]+):/.exec(said);
  if (shorthand) return shorthand[1].toLowerCase();
  try {
    const parsed = new URL(said);
    return parsed.hostname === "" ? undefined : parsed.hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** What this device holds for the host that address is at, if anything. */
export function credentialFor(
  held: readonly HeldCredential[],
  url: string,
): Credential | undefined {
  const host = remoteHost(url);
  if (host === undefined) return undefined;
  return held.find((one) => one.host.toLowerCase() === host)?.credential;
}

/** `data` is rooted at {@link Files.dataPath}. An entry that cannot be read is
 *  left out rather than throwing: a credential is given again in a moment, and
 *  nothing else in the file is worth losing over one. */
export async function readCredentials(data: Files): Promise<HeldCredential[]> {
  const bytes = await data.read(CREDENTIALS_FILE);
  if (!bytes) return [];
  let held: unknown;
  try {
    held = JSON.parse(decodeText(bytes));
  } catch {
    return [];
  }
  if (!Array.isArray(held)) return [];
  return held.flatMap((one) => {
    const said = one as Partial<HeldCredential> | null;
    const credential = readCredential(said?.credential);
    if (typeof said?.host !== "string" || !said.host || !credential) return [];
    return [{ host: said.host, credential }];
  });
}

export async function writeCredentials(
  data: Files,
  held: readonly HeldCredential[],
): Promise<void> {
  await data.write(
    CREDENTIALS_FILE,
    encodeText(`${JSON.stringify(held, null, 2)}\n`),
  );
}

/** What a surface reaches what this device holds through, so no page spells
 *  where private data is — and nothing but the act that needs one is handed
 *  one. */
export interface CredentialsAccess {
  list(): Promise<HeldCredential[]>;
  /** What is held for the host that address is at, if anything. */
  forUrl(url: string): Promise<Credential | undefined>;
  /** Hold one for a host, in place of whatever was held for it. */
  hold(host: string, credential: Credential): Promise<void>;
  /** Let go of what was held for a host. Nothing held is success. */
  forget(host: string): Promise<void>;
}

/** {@link CredentialsAccess} over this device's private data. `files` is the
 *  shell's own, rooted anywhere. */
export class DeviceCredentials implements CredentialsAccess {
  constructor(private readonly files: Files) {}

  async list(): Promise<HeldCredential[]> {
    return readCredentials(await this.own());
  }

  async forUrl(url: string): Promise<Credential | undefined> {
    return credentialFor(await this.list(), url);
  }

  async hold(host: string, credential: Credential): Promise<void> {
    const kept = (await this.list()).filter(
      (one) => one.host.toLowerCase() !== host.toLowerCase(),
    );
    await writeCredentials(await this.own(), [...kept, { host, credential }]);
  }

  async forget(host: string): Promise<void> {
    const kept = (await this.list()).filter(
      (one) => one.host.toLowerCase() !== host.toLowerCase(),
    );
    await writeCredentials(await this.own(), kept);
  }

  private async own(): Promise<Files> {
    return this.files.at(await this.files.dataPath());
  }
}

function readCredential(said: unknown): Credential | undefined {
  const one = said as { kind?: unknown } | null;
  if (one?.kind === "token") {
    const token = one as { username?: unknown; token?: unknown };
    if (typeof token.token !== "string" || !token.token) return undefined;
    return {
      kind: "token",
      ...(typeof token.username === "string" && token.username
        ? { username: token.username }
        : {}),
      token: token.token,
    };
  }
  if (one?.kind === "ssh") {
    const key = readSshKey((one as { key?: unknown }).key);
    return key === undefined ? undefined : { kind: "ssh", key };
  }
  return undefined;
}
