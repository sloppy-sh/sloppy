// Where a project keeps its notes, and where the code it is about is —
// docs/ARCHITECTURE.md § "A project's container".

import { GRAPH_FILE, type VaultGraph } from "@sloppy/vault";
import type { Files } from "./files.js";

/** What the vault inside a project's root folder is called. */
export const CONTAINER_DIR = ".sloppy";

/** How far below the folder somebody picked the container sits. */
const CONTAINER_DEPTH = CONTAINER_DIR.split("/").length;

/** The vault inside `root`, or absent where that folder holds no graph — which
 *  is an ordinary folder somebody picked, and not a failure. */
export async function containerOf(root: Files): Promise<Files | undefined> {
  const vault = root.at(CONTAINER_DIR);
  return (await vault.exists(GRAPH_FILE)) ? vault : undefined;
}

/**
 * The folder the graph's `project` names, read from the vault it is the graph
 * of. Absent where the graph names none, and where the path named would land
 * outside the folder somebody picked — everything the app reads is under that
 * folder, so a path leaving it is refused rather than followed.
 */
export function projectRootOf(
  vault: Files,
  graph: VaultGraph,
): Files | undefined {
  if (graph.project === undefined) return undefined;
  const at = landing(vault.root, graph.project);
  return at === undefined ? undefined : vault.at(at);
}

/**
 * Where `path`, read from `root`, lands — absent where it leaves the picked
 * folder, or where the shell spelled `root` from somewhere other than the top:
 * `Files.at` reads a relative path from the folder it is on, so nothing above
 * the vault can be named except absolutely.
 */
function landing(root: string, path: string): string | undefined {
  if (!root.startsWith("/") || path.startsWith("/") || path.includes("\\")) {
    return undefined;
  }
  if (/^[A-Za-z]:/.test(path)) return undefined;
  const held = root.split("/");
  let below = CONTAINER_DEPTH;
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment !== "..") {
      below += 1;
      held.push(segment);
      continue;
    }
    below -= 1;
    if (below < 0 || held.length <= 1) return undefined;
    held.pop();
  }
  const at = held.join("/");
  return at === "" ? "/" : at;
}
