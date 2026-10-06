// The chats this device holds: kept one file each, read back in the order a
// person reads them, and one that cannot be read left out rather than lost.

import type { ChatThread } from "@sloppy/types";
import { encodeText } from "@sloppy/vault";
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryFiles } from "./files.js";
import { DeviceThreads, threadFile, THREADS_DIR } from "./threads.js";

const GRAPH =
  "did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE/01JQ7X3K9M2N4P5R6S7T8V9W2Z";

const IDS = [
  "01JQ7X3K9M2N4P5R6S7T8V9W01",
  "01JQ7X3K9M2N4P5R6S7T8V9W02",
  "01JQ7X3K9M2N4P5R6S7T8V9W03",
] as const;

function aThread(id: string, more: Partial<ChatThread> = {}): ChatThread {
  return {
    id,
    name: `About ${id}`,
    graph: GRAPH,
    project: "/work/compiler",
    created_at: "2026-10-01T09:00:00.000Z",
    updated_at: "2026-10-01T09:00:00.000Z",
    places: [],
    turns: [],
    ...more,
  };
}

let files: MemoryFiles;
let threads: DeviceThreads;

beforeEach(() => {
  files = new MemoryFiles({ root: "/device", data: "/data" });
  threads = new DeviceThreads(files);
});

describe("the chats this device holds", () => {
  it("keeps one and reads it back whole", async () => {
    const held = aThread(IDS[0], {
      agent: "claude_code",
      model: "opus",
      session: "s-1",
      places: [{ root: "/work/other", name: "other", graph: GRAPH }],
      turns: [
        {
          from: "person",
          blocks: [{ kind: "said", said: "why two passes?" }],
          at: "2026-10-01T09:01:00.000Z",
        },
      ],
      spent: { sent: 100, answered: 20, cost: 0.02 },
    });

    await threads.write(held);

    expect(await threads.read(IDS[0])).toEqual(held);
    expect(await threads.list()).toEqual([held]);
  });

  it("keeps each one in its own file under the app's own data", async () => {
    await threads.write(aThread(IDS[0]));
    await threads.write(aThread(IDS[1]));

    const data = files.at(await files.dataPath());
    expect((await data.list(THREADS_DIR)).sort()).toEqual([
      threadFile(IDS[0]),
      threadFile(IDS[1]),
    ]);
  });

  it("answers nothing for a chat it does not hold, and lists none at first", async () => {
    expect(await threads.list()).toEqual([]);
    expect(await threads.read(IDS[0])).toBeUndefined();
  });

  it("answers the one written to most recently first", async () => {
    await threads.write(
      aThread(IDS[0], { updated_at: "2026-10-01T09:00:00.000Z" }),
    );
    await threads.write(
      aThread(IDS[1], { updated_at: "2026-10-03T09:00:00.000Z" }),
    );
    await threads.write(
      aThread(IDS[2], { updated_at: "2026-10-02T09:00:00.000Z" }),
    );

    expect((await threads.list()).map((one) => one.id)).toEqual([
      IDS[1],
      IDS[2],
      IDS[0],
    ]);
  });

  it("leaves out a chat it cannot read and answers with the rest", async () => {
    const held = aThread(IDS[0]);
    await threads.write(held);
    const data = files.at(await files.dataPath());
    await data.write(threadFile(IDS[1]), encodeText("{ not json"));
    await data.write(
      threadFile(IDS[2]),
      encodeText(JSON.stringify({ id: IDS[2], name: "half a chat" })),
    );

    expect(await threads.list()).toEqual([held]);
    expect(await threads.read(IDS[1])).toBeUndefined();
    expect(await threads.read(IDS[2])).toBeUndefined();
  });

  it("writes over the one already held rather than keeping a second", async () => {
    await threads.write(aThread(IDS[0]));
    await threads.write(aThread(IDS[0], { name: "Called something else" }));

    const listed = await threads.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].name).toBe("Called something else");
  });

  it("takes one away, and taking one that is gone is no failure", async () => {
    await threads.write(aThread(IDS[0]));
    await threads.write(aThread(IDS[1]));

    await threads.remove(IDS[0]);

    expect((await threads.list()).map((one) => one.id)).toEqual([IDS[1]]);
    await threads.remove(IDS[0]);
    expect((await threads.list()).map((one) => one.id)).toEqual([IDS[1]]);
  });
});
