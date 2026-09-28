// A graph that is a project's notes: the container inside the project's root,
// the code beside it, and a note saying when its reasoning was last read
// against that code — docs/ARCHITECTURE.md § "A project's container".

import type { DidSyr, OwnedRef } from "@sloppy/types";
import {
  digestOf,
  driftOf,
  encodeText,
  GRAPH_FILE,
  readGraphFile,
  readingsNow,
} from "@sloppy/vault";
import { describe, expect, it } from "vitest";
import { LocalApi, holdsAGraph } from "./api.js";
import { digestsIn } from "./code.js";
import { CONTAINER_DIR } from "./container.js";
import type { Files } from "./files.js";
import { MemoryFiles } from "./files.js";
import { type Device, PickingFiles, device } from "./local.test-support.js";

const PROJECT = "/work/compiler";
const GUEST = "did:syr:z6MkGuestReadingHere" as DidSyr;

/** A device where the folder somebody picks is a project of their own. */
function project(): Device {
  return device([PROJECT]);
}

async function wroteCode(files: Files): Promise<void> {
  await files
    .at(PROJECT)
    .write("src/parser.ts", encodeText("export const parse = 1;\n"));
}

describe("a project's notes", () => {
  it("are started in the container, with the code beside them", async () => {
    const { api, files } = project();
    await wroteCode(files);

    const graph = await api.openProject(PROJECT);

    const inside = files.at(`${PROJECT}/${CONTAINER_DIR}`);
    const said = readGraphFile((await inside.read(GRAPH_FILE)) as Uint8Array);
    expect(said.project).toBe("..");
    expect(graph.title).toBe("compiler");
    // The project's root is the folder, and nothing of ours is written in it.
    expect(await files.at(PROJECT).exists(GRAPH_FILE)).toBe(false);
    expect((await api.projectFolder())?.root).toBe(PROJECT);
  });

  it("are what the folder somebody picked holds, and open with it", async () => {
    const { api, files, store } = project();
    await wroteCode(files);
    await api.openProject(PROJECT);
    const written = await api.createNode({
      title: "Why the parser is hand-rolled",
      from: { relation: "branch" },
    });

    // A second client reads the same folder, the way the app does on a
    // relaunch: the project's own root is what it is handed.
    const again = new LocalApi(new PickingFiles({ store }).at(PROJECT));
    expect(await holdsAGraph(files.at(PROJECT))).toBe(true);
    expect((await again.getNode(written.ref))?.title).toBe(
      "Why the parser is hand-rolled",
    );
    expect((await again.projectFolder())?.root).toBe(PROJECT);
  });

  it("are asked for by folder where nobody named one", async () => {
    const { api, files } = project();
    await wroteCode(files);

    await api.openProject();

    expect((await api.projectFolder())?.root).toBe(PROJECT);
  });

  it("reach the code beside them and nothing above it", async () => {
    const { api, files } = project();
    await wroteCode(files);
    await files.at("/work").write("secrets.env", encodeText("TOKEN=1"));
    await api.openProject(PROJECT);

    const code = (await api.projectFolder()) as Files;

    expect(await code.read("src/parser.ts")).toEqual(
      encodeText("export const parse = 1;\n"),
    );
    await expect(code.read("../secrets.env")).rejects.toThrow();
    expect(await code.read("src/nowhere.ts")).toBeUndefined();
  });

  it("are nobody's project where the folder is a graph of its own", async () => {
    const { api } = device();
    await api.createGraph({ title: "The garden" });

    expect(await api.projectFolder()).toBeUndefined();
  });

  it("are a graph the folder holds, so a folder holding nothing is none", async () => {
    expect(await holdsAGraph(new MemoryFiles({ root: "/work/empty" }))).toBe(
      false,
    );
  });
});

describe("saying a note's reasoning still holds", () => {
  async function note(): Promise<{
    api: LocalApi;
    store: Map<string, Uint8Array>;
    ref: OwnedRef;
  }> {
    const { api, files, store } = project();
    await wroteCode(files);
    await api.openProject(PROJECT);
    const written = await api.createNode({
      title: "Why the parser is hand-rolled",
      from: { relation: "branch" },
    });
    return { api, store, ref: written.ref };
  }

  it("writes the commit it was read against and nothing else", async () => {
    const { api, store, ref } = await note();
    const was = await api.getNode(ref);

    const held = await api.updateNode(ref, { checked: "c0ffee" });

    expect(held.checked).toBe("c0ffee");
    expect(held.updated_at).toBe(was?.updated_at);
    expect(held.title).toBe(was?.title);
    // It is in the folder, so the next read of it says the same.
    const again = new LocalApi(new PickingFiles({ store }).at(PROJECT));
    expect((await again.getNode(ref))?.checked).toBe("c0ffee");
  });

  it("is not writing in the note, so nobody joins its writing", async () => {
    const { store, ref } = await note();
    const guest = new LocalApi(new PickingFiles({ store }).at(PROJECT), {
      writer: GUEST,
    });

    const held = await guest.updateNode(ref, { checked: "c0ffee" });
    expect(held.authors).toBeUndefined();

    // Writing in it is what puts somebody's name on it.
    const written = await guest.updateNode(ref, { title: "Hand-rolled" });
    expect(written.authors).toContain(GUEST);
  });

  it("is absent on a note nobody has confirmed", async () => {
    const { api, ref } = await note();
    expect((await api.getNode(ref))?.checked).toBeUndefined();
    expect((await api.getNode(ref))?.read_against).toBeUndefined();
  });

  it("writes each file it was read against, and the folder keeps them", async () => {
    const { api, store, ref } = await note();
    const was = await api.getNode(ref);
    const readings = [
      { path: "src/parser.ts", digest: `sha256:${"a".repeat(64)}` },
    ];

    const held = await api.updateNode(ref, { read_against: readings });

    expect(held.read_against).toEqual(readings);
    expect(held.updated_at).toBe(was?.updated_at);
    const again = new LocalApi(new PickingFiles({ store }).at(PROJECT));
    expect((await again.getNode(ref))?.read_against).toEqual(readings);
  });

  it("is a reading and not a write, so nobody joins the note's writing", async () => {
    const { store, ref } = await note();
    const guest = new LocalApi(new PickingFiles({ store }).at(PROJECT), {
      writer: GUEST,
    });

    const held = await guest.updateNode(ref, {
      read_against: [
        { path: "src/parser.ts", digest: `sha256:${"a".repeat(64)}` },
      ],
    });
    expect(held.authors).toBeUndefined();
  });

  it("takes every reading off where the whole list is empty", async () => {
    const { api, ref } = await note();
    await api.updateNode(ref, {
      read_against: [
        { path: "src/parser.ts", digest: `sha256:${"a".repeat(64)}` },
      ],
    });

    expect(
      (await api.updateNode(ref, { read_against: [] })).read_against,
    ).toEqual([]);
  });
});

describe("what the project's files say now", () => {
  it("is what a note read against them is compared to", async () => {
    const { api, files } = project();
    await wroteCode(files);
    await api.openProject(PROJECT);
    const code = (await api.projectFolder()) as Files;

    const readings = await readingsNow(["src/parser.ts"], digestsIn(code));
    expect(readings).toEqual([
      {
        path: "src/parser.ts",
        digest: await digestOf(encodeText("export const parse = 1;\n")),
      },
    ]);
    expect(await driftOf(readings, digestsIn(code))).toEqual([]);

    await code.write("src/parser.ts", encodeText("export const parse = 2;\n"));
    expect(await driftOf(readings, digestsIn(code))).toEqual(["src/parser.ts"]);
  });

  it("says nothing about a file the project has not got", async () => {
    const { api, files } = project();
    await wroteCode(files);
    await api.openProject(PROJECT);
    const code = (await api.projectFolder()) as Files;
    expect(await digestsIn(code)("src/gone.ts")).toBeUndefined();
  });

  it("reads one file once, however many notes point at it", async () => {
    const { api, files } = project();
    await wroteCode(files);
    await api.openProject(PROJECT);
    const code = (await api.projectFolder()) as Files;
    let asked = 0;
    const counting: Files = {
      ...code,
      read: (path) => {
        asked++;
        return code.read(path);
      },
    };

    const now = digestsIn(counting);
    expect(await now("src/parser.ts")).toBe(await now("src/parser.ts"));
    expect(asked).toBe(1);
  });
});
