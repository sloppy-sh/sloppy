// The folders this device keeps a graph in. A vault cannot remember where
// somebody put it, so the list lives in the app's own private data —
// docs/ARCHITECTURE.md § "Local-only mode".

import { type Timestamp, nowIso } from "@sloppy/types";
import { decodeText, encodeText } from "@sloppy/vault";
import type { Files } from "./files.js";

/** What `vaults.json` is called, under {@link Files.dataPath}. */
export const VAULTS_FILE = "vaults.json";

export interface KnownVault {
  /** As the platform spells it, which is what {@link Files.at} takes. */
  root: string;
  /** When this device first opened it, and when it last said so — a folder
   *  carries neither, and a listing is ordered by them. */
  created_at: Timestamp;
  updated_at: Timestamp;
}

export async function readVaults(data: Files): Promise<KnownVault[]> {
  const bytes = await data.read(VAULTS_FILE);
  if (!bytes) return [];
  let held: unknown;
  try {
    held = JSON.parse(decodeText(bytes));
  } catch {
    return [];
  }
  if (!Array.isArray(held)) return [];
  return held.flatMap((one) => {
    const said = one as Partial<KnownVault> | null;
    if (!said || typeof said.root !== "string") return [];
    const at = nowIso();
    return [
      {
        root: said.root,
        created_at: typeof said.created_at === "string" ? said.created_at : at,
        updated_at: typeof said.updated_at === "string" ? said.updated_at : at,
      },
    ];
  });
}

export async function writeVaults(
  data: Files,
  vaults: readonly KnownVault[],
): Promise<void> {
  await data.write(
    VAULTS_FILE,
    encodeText(`${JSON.stringify(vaults, null, 2)}\n`),
  );
}
