// The builds this device holds, one file per build — docs/ARCHITECTURE.md
// § "Building from the notes". They are this device's alone: a build is where
// somebody got to, not something a peer reads.

import { type Build, BuildSchema } from "@sloppy/types";
import { decodeText, encodeText } from "@sloppy/vault";
import type { Files } from "./files.js";

/** The folder they are kept in, under {@link Files.dataPath}, beside the
 *  threads. */
export const BUILDS_DIR = "builds";

/** Where one build is kept, under {@link Files.dataPath}. */
export function buildFile(id: string): string {
  return `${BUILDS_DIR}/${id}.json`;
}

/**
 * What a surface reaches the builds this device holds through. `list` answers
 * the ones started most recently first; `remove` on a build that is not there
 * is not a failure.
 *
 * No session is ever kept here — {@link Build} holds the row per session and
 * never the session, so a build read back is one a fresh session goes on with.
 */
export interface BuildsAccess {
  list(): Promise<Build[]>;
  read(id: string): Promise<Build | undefined>;
  write(build: Build): Promise<void>;
  remove(id: string): Promise<void>;
}

export class DeviceBuilds implements BuildsAccess {
  constructor(private readonly files: Files) {}

  /** A file that does not parse is LEFT OUT rather than thrown on, as a
   *  thread's is — docs/ARCHITECTURE.md § "Building from the notes". */
  async list(): Promise<Build[]> {
    const data = await this.data();
    const held = await data.list(BUILDS_DIR).catch(() => [] as string[]);
    const read = await Promise.all(
      held
        .filter((path) => path.endsWith(".json"))
        .map((path) => buildAt(data, path)),
    );
    return read
      .flatMap((build) => (build === undefined ? [] : [build]))
      .sort((one, two) => two.created.localeCompare(one.created));
  }

  async read(id: string): Promise<Build | undefined> {
    return buildAt(await this.data(), buildFile(id));
  }

  async write(build: Build): Promise<void> {
    const data = await this.data();
    await data.write(
      buildFile(build.id),
      encodeText(`${JSON.stringify(build, null, 2)}\n`),
    );
  }

  async remove(id: string): Promise<void> {
    await (await this.data()).remove(buildFile(id));
  }

  private async data(): Promise<Files> {
    return this.files.at(await this.files.dataPath());
  }
}

async function buildAt(data: Files, path: string): Promise<Build | undefined> {
  const bytes = await data.read(path).catch(() => undefined);
  if (!bytes) return undefined;
  try {
    const read = BuildSchema.safeParse(JSON.parse(decodeText(bytes)));
    return read.success ? read.data : undefined;
  } catch {
    return undefined;
  }
}
