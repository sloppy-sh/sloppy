// A graph that is a project's notes: the container inside the project's root,
// the code beside it, and a note saying when its reasoning was last read
// against that code — docs/ARCHITECTURE.md § "A project's container".

import type { DidSyr, OwnedRef } from "@sloppy/types";
import { encodeText, GRAPH_FILE, readGraphFile } from "@sloppy/vault";
import { describe, expect, it } from "vitest";
import { LocalApi, holdsAGraph } from "./api.js";
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
    expect(await api.projectHere()).toBe(true);
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
    expect(await again.readProjectFile("src/parser.ts")).toBe(
      "export const parse = 1;\n",
    );
  });

  it("are asked for by folder where nobody named one", async () => {
    const { api, files } = project();
    await wroteCode(files);

    await api.openProject();

    expect(await api.projectHere()).toBe(true);
  });

  it("read the code beside them and nothing else", async () => {
    const { api, files } = project();
    await wroteCode(files);
    await files.at("/work").write("secrets.env", encodeText("TOKEN=1"));
    await files
      .at(PROJECT)
      .write("logo.png", new Uint8Array([137, 80, 78, 71, 0, 13]));
    await api.openProject(PROJECT);

    expect(await api.readProjectFile("src/parser.ts")).toBe(
      "export const parse = 1;\n",
    );
    expect(await api.readProjectFile("../secrets.env")).toBeUndefined();
    expect(await api.readProjectFile("/work/secrets.env")).toBeUndefined();
    expect(await api.readProjectFile("src/nowhere.ts")).toBeUndefined();
    expect(await api.readProjectFile("logo.png")).toBeUndefined();
  });

  it("are nobody's project where the folder is a graph of its own", async () => {
    const { api } = device();
    await api.createGraph({ title: "The garden" });

    expect(await api.projectHere()).toBe(false);
    expect(await api.readProjectFile("src/parser.ts")).toBeUndefined();
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
  });
});
