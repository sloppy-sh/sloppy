// The project's own history, asked through the `git` it already has.

import { execFile } from "node:child_process";

/** A git that said no, in its own words — which are for the log, not a person. */
export class GitRefused extends Error {}

/** What `git <args>` printed, run in `cwd`. */
export function git(
  cwd: string,
  args: readonly string[],
  input?: string,
): Promise<string> {
  return new Promise((done, failed) => {
    const child = execFile(
      "git",
      args,
      { cwd, maxBuffer: 256 * 1024 * 1024, encoding: "buffer" },
      (error, stdout, stderr) => {
        if (error) {
          failed(new GitRefused(stderr.toString().trim() || error.message));
          return;
        }
        done(stdout.toString());
      },
    );
    if (input !== undefined) child.stdin?.end(input);
  });
}

/** Whether `git <args>` succeeds, for a question asked by its exit code. */
export function gitSays(
  cwd: string,
  args: readonly string[],
): Promise<boolean> {
  return git(cwd, args).then(
    () => true,
    () => false,
  );
}

/** Every file under `prefix` at `rev`, by its path below `prefix`. */
export async function filesAt(
  cwd: string,
  rev: string,
  prefix: string,
): Promise<Map<string, Uint8Array>> {
  const listed = (
    await git(cwd, ["ls-tree", "-r", "-z", "--name-only", rev, "--", prefix])
  )
    .split("\0")
    .filter((path) => path !== "");
  const held = new Map<string, Uint8Array>();
  if (listed.length === 0) return held;
  const bytes = await batch(
    cwd,
    listed.map((path) => `${rev}:${path}`),
  );
  const below = prefix === "" ? "" : `${prefix}/`;
  listed.forEach((path, at) => {
    const one = bytes[at];
    if (one !== undefined) held.set(path.slice(below.length), one);
  });
  return held;
}

/** The blobs named, read in one `cat-file --batch`; a name that is not a blob
 *  is absent. */
function batch(
  cwd: string,
  names: readonly string[],
): Promise<(Uint8Array | undefined)[]> {
  return new Promise((done, failed) => {
    const child = execFile(
      "git",
      ["cat-file", "--batch"],
      { cwd, maxBuffer: 1024 * 1024 * 1024, encoding: "buffer" },
      (error, stdout) => {
        if (error) {
          failed(new GitRefused(error.message));
          return;
        }
        done(blobsIn(stdout, names.length));
      },
    );
    child.stdin?.end(`${names.join("\n")}\n`);
  });
}

function blobsIn(out: Buffer, count: number): (Uint8Array | undefined)[] {
  const held: (Uint8Array | undefined)[] = [];
  let at = 0;
  for (let one = 0; one < count; one++) {
    const end = out.indexOf(0x0a, at);
    if (end === -1) break;
    const header = out.subarray(at, end).toString().split(" ");
    at = end + 1;
    if (header[1] !== "blob") {
      held.push(undefined);
      continue;
    }
    const size = Number(header[2]);
    held.push(new Uint8Array(out.subarray(at, at + size)));
    at += size + 1;
  }
  return held;
}
