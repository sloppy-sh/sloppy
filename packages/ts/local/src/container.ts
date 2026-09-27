// Where a project keeps its notes, and where the code it is about is —
// docs/ARCHITECTURE.md § "A project's container".

import { GRAPH_FILE, SLOPPY_DIR, type VaultGraph } from "@sloppy/vault";
import type { Files } from "./files.js";

/** What the vault inside a project's root folder is called. */
export const CONTAINER_DIR = ".sloppy";

const ATTACHED = "attached";

/**
 * Where a file somebody put in front of an agent goes, said from the folder the
 * container sits in. **The agent READS it there**, which is why nothing carries
 * its bytes and no act was added for one — docs/ARCHITECTURE.md § "Asking a
 * tool to write the notes".
 */
export const ATTACHED_DIR = `${CONTAINER_DIR}/${ATTACHED}`;

/** The same folder as the history is told to pass over it, which is said from
 *  inside the container — {@link KEPT_OUT} in `./kept-out.js`. */
export const ATTACHED_KEPT_OUT = `/${ATTACHED}/`;

/**
 * Where what is nobody else's business goes for the project rooted at `root`,
 * spelled as the platform spells `root`: inside the container's own sidecar
 * folder, the one place in a repository that is Sloppy's rather than the
 * person's.
 *
 * **Everything writing a project's notes as the CONTAINER must root its data
 * here**, because the identity kept there is who that writing is by: a second
 * folder is a second identity in one container, and each then offers the other
 * amendments to notes no person ever wrote in — docs/ARCHITECTURE.md
 * § "Asking a tool to write the notes". `keepingDataAt` in `./files.js` is what
 * hands it to a store.
 */
export function containerDataAt(root: string): string {
  return `${root}/${CONTAINER_DIR}/${SLOPPY_DIR}`;
}

/** The vault inside `root`, or absent where that folder holds no graph — which
 *  is an ordinary folder somebody picked, and not a failure. */
export async function containerOf(root: Files): Promise<Files | undefined> {
  const vault = root.at(CONTAINER_DIR);
  return (await vault.exists(GRAPH_FILE)) ? vault : undefined;
}

/**
 * The folder the graph's `project` names, read from the vault it is the graph
 * of. Absent where the graph names none, where the vault is not a container,
 * and where the path named would land outside the folder the container sits
 * in — everything the app reads is under the folder somebody picked.
 */
export function projectRootOf(
  vault: Files,
  graph: VaultGraph,
): Files | undefined {
  if (graph.project === undefined) return undefined;
  const container = containerAt(vault.root);
  if (container === undefined) return undefined;
  const at = landing(container.vault, graph.project);
  if (at === undefined || !within(container.project, at)) return undefined;
  return vault.at(at);
}

/**
 * The container `root` is, and the folder it sits in. Absent where `root` is
 * an ordinary vault rather than a `<project>/.sloppy`, so a `project` written
 * into any other graph file names nothing at all; and absent where the shell
 * spelled `root` from somewhere other than the top, because `Files.at` reads a
 * relative path from the folder it is on and nothing above the vault can be
 * named except absolutely.
 */
function containerAt(
  root: string,
): { vault: string; project: string } | undefined {
  const vault = root.replace(/\/+$/, "");
  if (!vault.startsWith("/")) return undefined;
  const above = vault.split("/");
  if (above.pop() !== CONTAINER_DIR) return undefined;
  return { vault, project: above.join("/") || "/" };
}

/** Where `path`, read from the folder at `from`, lands. Absent where it names
 *  a drive, starts at the top of one, or climbs past the top. */
function landing(from: string, path: string): string | undefined {
  if (path.startsWith("/") || path.includes("\\")) return undefined;
  if (/^[A-Za-z]:/.test(path)) return undefined;
  const held = from.split("/");
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment !== "..") {
      held.push(segment);
      continue;
    }
    if (held.length <= 1) return undefined;
    held.pop();
  }
  return held.join("/") || "/";
}

/** Whether `at` is `folder` itself or somewhere under it. */
function within(folder: string, at: string): boolean {
  return at === folder || at.startsWith(folder === "/" ? "/" : `${folder}/`);
}
