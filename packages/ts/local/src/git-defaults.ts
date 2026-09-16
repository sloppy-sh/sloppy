// What a folder started on this device inherits about its history: who its
// commits are by and how they are signed —
// docs/ARCHITECTURE.md § "The vault's history".

import { decodeText, encodeText } from "@sloppy/vault";
import type { Files } from "./files.js";
import type { GitUser, SigningConfig, SshKey } from "./history.js";

/** What this is called, under {@link Files.dataPath}. */
export const GIT_DEFAULTS_FILE = "git.json";

/** The private half of the ssh key this app made, under
 *  {@link Files.dataPath}. It is what `{ kind: "kept" }` names, and it never
 *  leaves the device: no vault holds it, no archive carries it and no commit
 *  keeps it. */
export const KEPT_KEY_FILE = "signing.key";

/**
 * What a folder started on this device begins with. A folder's own settings
 * are the folder's from then on, so changing these changes nothing already
 * written down in one.
 *
 * Either half absent is a device that has not been told, and the folder is
 * left to say for itself — whoever the person's own git config names, and
 * nothing signed.
 */
export interface GitDefaults {
  user?: GitUser;
  signing?: SigningConfig;
}

/** `data` is rooted at {@link Files.dataPath}. A file that cannot be read as
 *  this reads as a device that has not been told: nothing a person cannot say
 *  again is in it. */
export async function readGitDefaults(data: Files): Promise<GitDefaults> {
  const bytes = await data.read(GIT_DEFAULTS_FILE);
  if (!bytes) return {};
  let held: unknown;
  try {
    held = JSON.parse(decodeText(bytes));
  } catch {
    return {};
  }
  const said = held as Partial<GitDefaults> | null;
  const user = readGitUser(said?.user);
  const signing = readSigning(said?.signing);
  return {
    ...(user === undefined ? {} : { user }),
    ...(signing === undefined ? {} : { signing }),
  };
}

export async function writeGitDefaults(
  data: Files,
  defaults: GitDefaults,
): Promise<void> {
  await data.write(
    GIT_DEFAULTS_FILE,
    encodeText(`${JSON.stringify(defaults, null, 2)}\n`),
  );
}

/** What a surface reaches this device's defaults through, so no page spells
 *  where private data is. */
export interface GitDefaultsAccess {
  read(): Promise<GitDefaults>;
  write(defaults: GitDefaults): Promise<void>;
}

/** {@link GitDefaultsAccess} over this device's private data. `files` is the
 *  shell's own, rooted anywhere. */
export class DeviceGitDefaults implements GitDefaultsAccess {
  constructor(private readonly files: Files) {}

  async read(): Promise<GitDefaults> {
    return readGitDefaults(await this.own());
  }

  async write(defaults: GitDefaults): Promise<void> {
    await writeGitDefaults(await this.own(), defaults);
  }

  private async own(): Promise<Files> {
    return this.files.at(await this.files.dataPath());
  }
}

export function readGitUser(said: unknown): GitUser | undefined {
  const one = said as Partial<GitUser> | null;
  if (typeof one?.name !== "string" || typeof one.email !== "string") {
    return undefined;
  }
  return { name: one.name, email: one.email };
}

export function readSshKey(said: unknown): SshKey | undefined {
  const one = said as { kind?: unknown; path?: unknown } | null;
  if (one?.kind === "kept") return { kind: "kept" };
  if (one?.kind === "file" && typeof one.path === "string") {
    return { kind: "file", path: one.path };
  }
  return undefined;
}

export function readSigning(said: unknown): SigningConfig | undefined {
  const one = said as { kind?: unknown } | null;
  if (one?.kind === "none") return { kind: "none" };
  if (one?.kind === "ssh") {
    const key = readSshKey((one as { key?: unknown }).key);
    return key === undefined ? undefined : { kind: "ssh", key };
  }
  if (one?.kind === "openpgp") {
    const openpgp = one as { program?: unknown; keyId?: unknown };
    return {
      kind: "openpgp",
      ...(typeof openpgp.program === "string"
        ? { program: openpgp.program }
        : {}),
      ...(typeof openpgp.keyId === "string" ? { keyId: openpgp.keyId } : {}),
    };
  }
  return undefined;
}
