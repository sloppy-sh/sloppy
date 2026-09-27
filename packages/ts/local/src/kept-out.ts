// What a project's own history is told to pass over. The container sits inside
// somebody's repository — docs/ARCHITECTURE.md § "A project's container".

import { decodeText, encodeText } from "@sloppy/vault";
import { BIN_DIR, BIN_FILE } from "./vault-paths.js";
import { ATTACHED_DIR } from "./container.js";
import { CREDENTIALS_FILE } from "./credentials.js";
import type { Files } from "./files.js";
import { GIT_DEFAULTS_FILE } from "./git-defaults.js";
import { IDENTITIES_FILE, IDENTITY_FILE } from "./identity.js";
import { VAULTS_FILE } from "./vaults.js";

const IGNORE_FILE = ".gitignore";

/**
 * The notes belong in the history and the keys do not.
 *
 * **Without these a key is committed, and a key committed is a key pushed.**
 * `*.key` covers every key rather than the two named ones: a key this build has
 * not named yet is the one mistake with no way back. A note's ink and what each
 * picture was called sit in the same folder and are the graph's own — they
 * belong in the history with the notes. What somebody handed the chat does not:
 * a photo taken to ask a question about it is theirs and this device's, and
 * committing it puts it somewhere they cannot take it back from.
 */
export const KEPT_OUT = [
  "*.key",
  "*.key.pub",
  "*.picture",
  IDENTITIES_FILE,
  IDENTITY_FILE,
  VAULTS_FILE,
  CREDENTIALS_FILE,
  GIT_DEFAULTS_FILE,
  "sloppy-identity*",
  `/${BIN_FILE}`,
  `/${BIN_DIR}/`,
  `/${ATTACHED_DIR}/`,
];

/**
 * Tell a container's history to pass over what is this device's alone.
 *
 * **Every way a container is reached calls this**, not only the one that makes
 * it: a container somebody's app started, or one made before these lines were
 * written, holds a key the moment anything writes as the container itself. A
 * file somebody wrote themselves stays theirs — the lines that are not there
 * are added, and nothing already in it is touched.
 */
export async function keepOut(container: Files): Promise<void> {
  const bytes = await container.read(IGNORE_FILE);
  const held = bytes ? decodeText(bytes) : "";
  const lines = held.split("\n").map((line) => line.trim());
  const missing = KEPT_OUT.filter((line) => !lines.includes(line));
  if (missing.length === 0) return;
  const before = held === "" || held.endsWith("\n") ? held : `${held}\n`;
  await container.write(
    IGNORE_FILE,
    encodeText(`${before}${missing.join("\n")}\n`),
  );
}
