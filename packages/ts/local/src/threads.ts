// The chats this device holds, one file per thread — docs/ARCHITECTURE.md
// § "Asking a tool to write the notes". They are this device's alone: a thread
// is where somebody was in a conversation, not something a peer reads.

import { type ChatThread, ChatThreadSchema } from "@sloppy/types";
import { decodeText, encodeText } from "@sloppy/vault";
import type { Files } from "./files.js";

/** The folder they are kept in, under {@link Files.dataPath}. */
export const THREADS_DIR = "threads";

/** Where one thread is kept, under {@link Files.dataPath}. */
export function threadFile(id: string): string {
  return `${THREADS_DIR}/${id}.json`;
}

/**
 * What a surface reaches the chats this device holds through. `list` answers
 * the ones most recently written to first, which is the order a person reads
 * them in; `remove` on a thread that is not there is not a failure.
 */
export interface ThreadsAccess {
  list(): Promise<ChatThread[]>;
  read(id: string): Promise<ChatThread | undefined>;
  write(thread: ChatThread): Promise<void>;
  remove(id: string): Promise<void>;
}

export class DeviceThreads implements ThreadsAccess {
  constructor(private readonly files: Files) {}

  /** A file that does not parse is LEFT OUT rather than thrown on: one chat
   *  somebody cannot reopen is not worth the app. */
  async list(): Promise<ChatThread[]> {
    const data = await this.data();
    const held = await data.list(THREADS_DIR).catch(() => [] as string[]);
    const read = await Promise.all(
      held
        .filter((path) => path.endsWith(".json"))
        .map((path) => threadAt(data, path)),
    );
    return read
      .flatMap((thread) => (thread === undefined ? [] : [thread]))
      .sort((one, two) => two.updated_at.localeCompare(one.updated_at));
  }

  async read(id: string): Promise<ChatThread | undefined> {
    return threadAt(await this.data(), threadFile(id));
  }

  async write(thread: ChatThread): Promise<void> {
    const data = await this.data();
    await data.write(
      threadFile(thread.id),
      encodeText(`${JSON.stringify(thread, null, 2)}\n`),
    );
  }

  async remove(id: string): Promise<void> {
    await (await this.data()).remove(threadFile(id));
  }

  private async data(): Promise<Files> {
    return this.files.at(await this.files.dataPath());
  }
}

async function threadAt(
  data: Files,
  path: string,
): Promise<ChatThread | undefined> {
  const bytes = await data.read(path).catch(() => undefined);
  if (!bytes) return undefined;
  try {
    const read = ChatThreadSchema.safeParse(JSON.parse(decodeText(bytes)));
    return read.success ? read.data : undefined;
  } catch {
    return undefined;
  }
}
