import { ServerRequiredError, type SloppyApi } from "@sloppy/client";
import { HOME_GRAPH_ULID, splitOwnedRef } from "@sloppy/types";
import { GRAPH_FILE, decodeText, notePath } from "@sloppy/vault";
import { describe, expect, it } from "vitest";
import { LocalApi } from "./api.js";
import { MemoryFiles } from "./files.js";
import { device, reopened, textDocument } from "./local.test-support.js";

/** True only where every public member of the client is answered here, by
 *  shape. A missing method makes it false, so the port cannot drift away from
 *  this class without the build saying so. */
type Answers = LocalApi extends SloppyApi ? true : false;

const api = new LocalApi(new MemoryFiles());

describe("the client a graph on this device is served through", () => {
  it("answers the whole surface every page already talks to", () => {
    const answers: Answers = true;
    expect(answers).toBe(true);
  });

  it("says in words what needs another machine to exist", async () => {
    await expect(api.publish({} as never)).rejects.toBeInstanceOf(
      ServerRequiredError,
    );
    await expect(api.follow({} as never)).rejects.toBeInstanceOf(
      ServerRequiredError,
    );
    await expect(api.listComments("did:syr:z1/01J")).rejects.toThrow(
      "Comments needs a server connection",
    );
    await expect(api.profileOf("did:syr:z1")).rejects.toBeInstanceOf(
      ServerRequiredError,
    );
    await expect(api.emojiOf("did:syr:z1")).rejects.toBeInstanceOf(
      ServerRequiredError,
    );
  });

  it("writes under an identity nobody was asked to sign in as", async () => {
    const { api } = device();
    const me = await api.me();
    expect(me?.did).toMatch(/^did:syr:/);
    expect(await api.listGraphs()).toEqual([]);
  });

  it("says there is nowhere to write before a folder is chosen", async () => {
    const { api } = device([]);
    await expect(api.listNodes()).rejects.toThrow(
      "There is no graph on this device yet",
    );
    await expect(api.createGraph({ title: "Thesis" })).rejects.toThrow(
      "No folder was chosen",
    );
  });
});

describe("a graph in a folder", () => {
  it("starts one where a person put it, and reads it back off the disk", async () => {
    const held = device(["/graphs/thesis"]);
    const graph = await held.api.createGraph({ title: "Thesis" });
    expect(splitOwnedRef(graph.ref).localId).toBe(HOME_GRAPH_ULID);
    expect(held.store.has("/graphs/thesis/graph.json")).toBe(true);

    const note = await held.api.createNode({ title: "A first thought" });
    expect(note.address).toBe("1");

    const again = reopened(held);
    expect(await again.listGraphs()).toEqual([graph]);
    const read = await again.getNode(note.ref);
    expect(read?.title).toBe("A first thought");
    expect(read?.address).toBe("1");
    expect(read?.origin).toBe(note.ref);
    expect(read?.depth).toBe(1);
  });

  it("writes a note as one markdown file a person can open", async () => {
    const held = device();
    await held.api.createGraph({ title: "Thesis" });
    const note = await held.api.createNode({
      title: "Seeds",
      tags: ["biology"],
    });
    await held.api.createBlock({
      node: note.ref,
      content: textDocument("A seed keeps its own clock."),
    });
    const file = held.store.get(
      `/graphs/one/${notePath(splitOwnedRef(note.ref).localId)}`,
    );
    const said = decodeText(file ?? new Uint8Array());
    expect(said).toContain(`ref: ${note.ref}`);
    expect(said).toContain("address: 1");
    expect(said).toContain("- biology");
    expect(said).toContain("A seed keeps its own clock.");
  });

  it("keeps a second graph in a second folder", async () => {
    const held = device(["/graphs/one", "/graphs/garden"]);
    const first = await held.api.createGraph({ title: "Thesis" });
    const second = await held.api.createGraph({ title: "Garden" });
    expect(splitOwnedRef(second.ref).localId).not.toBe(HOME_GRAPH_ULID);

    const there = await held.api.createNode({
      from: { relation: "branch", graph: second.ref },
    });
    expect(there.graph).toBe(second.ref);
    expect((await held.api.listNodes({ graph: first.ref })).length).toBe(0);
    expect((await held.api.listNodes({ graph: second.ref })).length).toBe(1);
  });

  it("writes a child and a sibling in whichever graph they spring from", async () => {
    const held = device(["/graphs/one", "/graphs/garden"]);
    await held.api.createGraph({ title: "Thesis" });
    const second = await held.api.createGraph({ title: "Garden" });
    const root = await held.api.createNode({
      title: "Beds",
      from: { relation: "branch", graph: second.ref },
    });
    const child = await held.api.createNode({
      title: "Compost",
      from: { relation: "under", note: root.ref },
    });
    const sibling = await held.api.createNode({
      title: "Mulch",
      from: { relation: "after", note: child.ref },
    });

    const again = reopened(held);
    expect((await again.getNode(child.ref))?.graph).toBe(second.ref);
    expect((await again.getNode(child.ref))?.address).toBe("1a");
    expect((await again.getNode(sibling.ref))?.graph).toBe(second.ref);
    expect((await again.getNode(sibling.ref))?.address).toBe("1b");
    expect((await again.listNodes({ graph: second.ref })).length).toBe(1);
  });

  it("refuses a second graph in a folder that already holds one", async () => {
    const held = device(["/graphs/one", "/graphs/one"]);
    await held.api.createGraph({ title: "Thesis" });
    await expect(held.api.createGraph({ title: "Again" })).rejects.toThrow(
      "already a graph in that folder",
    );
  });

  it("renames the graph in the folder it is in", async () => {
    const held = device();
    const graph = await held.api.createGraph({ title: "Thesis" });
    await held.api.updateGraph(graph.ref, { title: "The thesis" });
    expect((await reopened(held).listGraphs())[0].title).toBe("The thesis");
  });

  it("takes its own files out of a folder it is closed in, and leaves the rest", async () => {
    const held = device();
    const graph = await held.api.createGraph({ title: "Thesis" });
    await held.api.createNode({ title: "A thought" });
    held.store.set("/graphs/one/README.md", new Uint8Array([1]));

    await held.api.closeGraph(graph.ref);
    expect(held.store.has(`/graphs/one/${GRAPH_FILE}`)).toBe(false);
    expect(held.store.has("/graphs/one/README.md")).toBe(true);
    expect(await reopened(held).listGraphs()).toEqual([]);
  });
});
