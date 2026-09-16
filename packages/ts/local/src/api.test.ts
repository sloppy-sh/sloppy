import { ServerRequiredError, type SloppyApi } from "@sloppy/client";
import { UNNAMED_GRAPH_ULID, splitOwnedRef } from "@sloppy/types";
import { GRAPH_FILE, decodeText, encodeText, notePath } from "@sloppy/vault";
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

describe("a picture in a graph on this device", () => {
  it("is kept by the client itself, with nothing sent anywhere", async () => {
    const held = device(["/graphs/thesis"]);
    await held.api.createGraph({ title: "Thesis" });
    const ticket = await held.api.createUpload({
      role: "block",
      filename: "seed.png",
      mime_type: "image/png",
      size: 3,
    });

    await held.api.sendUpload(ticket, new Blob([new Uint8Array([1, 2, 3])]));
    const asset = await held.api.completeUpload({
      upload_id: ticket.upload_id,
    });

    expect(asset.upload_id).toBe(ticket.upload_id);
    expect(
      held.store.get(`/graphs/thesis/media/${ticket.upload_id}.png`),
    ).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe("the folder a shell opened", () => {
  /** A client rooted at one folder, the way the native shell serves the graph
   *  somebody chose. */
  function opened(root: string, store = new Map<string, Uint8Array>()) {
    const files = new MemoryFiles({ root, store, data: "/data" });
    return { api: new LocalApi(files), files, store };
  }

  it("becomes the graph, named after itself, where it holds none", async () => {
    const held = opened("/Users/me/garden");

    const note = await held.api.createNode({ title: "A first thought" });

    expect(held.store.has(`/Users/me/garden/${GRAPH_FILE}`)).toBe(true);
    const graphs = await held.api.listGraphs();
    expect(graphs.map((one) => one.title)).toEqual(["garden"]);
    expect(splitOwnedRef(graphs[0].ref).localId).not.toBe(UNNAMED_GRAPH_ULID);
    expect(graphs[0].home).toBe(true);
    expect((await held.api.getNode(note.ref))?.title).toBe("A first thought");
  });

  it("is read rather than written over where it already holds a graph", async () => {
    const first = opened("/Users/me/garden");
    const note = await first.api.createNode({ title: "A first thought" });

    // A second launch: the folder is the same, and nothing of the first
    // client's index survives.
    const again = opened("/Users/me/garden", first.store);

    expect((await again.api.listGraphs()).map((one) => one.title)).toEqual([
      "garden",
    ]);
    expect((await again.api.getNode(note.ref))?.title).toBe("A first thought");
    expect((await again.api.listNodes()).length).toBe(1);
  });

  it("is the folder written in after the shell is pointed at another one", async () => {
    const first = opened("/Users/me/garden");
    await first.api.createNode({ title: "A first thought" });

    const second = opened("/Users/me/thesis", first.store);
    const note = await second.api.createNode({ title: "Chapter one" });

    expect(second.store.has(`/Users/me/thesis/${GRAPH_FILE}`)).toBe(true);
    expect(
      second.store.has(
        `/Users/me/thesis/${notePath(splitOwnedRef(note.ref).localId)}`,
      ),
    ).toBe(true);
    const graphs = await second.api.listGraphs();
    expect(graphs.map((one) => one.title)).toEqual(["garden", "thesis"]);
    // Every folder's graph is its own, and the one this device opened first is
    // the one it started with.
    expect(graphs[0].ref).not.toBe(graphs[1].ref);
    expect(graphs.map((one) => one.home)).toEqual([true, undefined]);
    expect((await second.api.listNodes()).map((one) => one.title)).toEqual([
      "Chapter one",
    ]);
  });

  it("says a folder it wrote a graph into is gone rather than starting a second one", async () => {
    const held = opened("/Users/me/garden");
    await held.api.createNode({ title: "A first thought" });
    for (const path of [...held.store.keys()]) {
      if (path.startsWith("/Users/me/garden")) held.store.delete(path);
    }
    held.store.set("/Users/me/garden/README.md", new Uint8Array());

    const again = opened("/Users/me/garden", held.store);

    await expect(again.api.createNode({ title: "Again" })).rejects.toThrow(
      "not there any more",
    );
    expect(again.store.has(`/Users/me/garden/${GRAPH_FILE}`)).toBe(false);
    expect(await again.api.listGraphs()).toEqual([]);
  });

  it("starts one graph between two reads that land together", async () => {
    const held = opened("/Users/me/garden");

    await Promise.all([
      held.api.listNodes(),
      held.api.listNodes(),
      held.api.createNode({ title: "A first thought" }),
    ]);

    expect((await held.api.listGraphs()).length).toBe(1);
  });

  // A read of the open folder starts a graph there and writes that folder down
  // without waiting behind a write, so a write holding a list it read earlier
  // would put the folder back the way it was before the read.
  it("keeps the folder a read wrote down while another was being chosen", async () => {
    let chose!: (root: string) => void;
    const chosen = new Promise<string>((answer) => (chose = answer));
    let asking!: () => void;
    const asked = new Promise<void>((answer) => (asking = answer));

    class Asking extends MemoryFiles {
      async pickFolder(): Promise<string | undefined> {
        asking();
        return chosen;
      }
    }

    const store = new Map<string, Uint8Array>();
    const api = new LocalApi(
      new Asking({ root: "/Users/me/garden", data: "/data", store }),
    );

    const starting = api.createGraph({ title: "Thesis" });
    await asked;
    await api.listNodes();
    chose("/Users/me/thesis");
    await starting;

    // Read with no folder open, so the answer is what was written down rather
    // than what the open folder holds.
    const written = new LocalApi(new MemoryFiles({ data: "/data", store }));
    expect((await written.listGraphs()).map((one) => one.title)).toEqual([
      "garden",
      "Thesis",
    ]);
  });
});

describe("a graph in a folder", () => {
  it("starts one where a person put it, and reads it back off the disk", async () => {
    const held = device(["/graphs/thesis"]);
    const graph = await held.api.createGraph({ title: "Thesis" });
    expect(splitOwnedRef(graph.ref).localId).not.toBe(UNNAMED_GRAPH_ULID);
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

  it("gives a folder that shared everybody's first ulid one of its own", async () => {
    const held = device(["/graphs/thesis"]);
    const graph = await held.api.createGraph({ title: "Thesis" });
    const note = await held.api.createNode({ title: "Beans" });

    // A folder written when every first graph was at the same ulid.
    const said = JSON.parse(
      decodeText(held.store.get("/graphs/thesis/graph.json") as Uint8Array),
    );
    held.store.set(
      "/graphs/thesis/graph.json",
      encodeText(`${JSON.stringify({ ...said, graph: UNNAMED_GRAPH_ULID })}\n`),
    );

    const again = reopened(held);
    const [opened] = await again.listGraphs();
    expect(splitOwnedRef(opened.ref).localId).not.toBe(UNNAMED_GRAPH_ULID);
    expect(opened.ref).not.toBe(graph.ref);
    expect(opened.title).toBe("Thesis");
    expect((await again.getNode(note.ref))?.title).toBe("Beans");

    // Written back, so the folder answers the same ulid the next time.
    expect((await reopened(held).listGraphs())[0].ref).toBe(opened.ref);
  });

  it("keeps a second graph in a second folder", async () => {
    const held = device(["/graphs/one", "/graphs/garden"]);
    const first = await held.api.createGraph({ title: "Thesis" });
    const second = await held.api.createGraph({ title: "Garden" });
    expect(second.ref).not.toBe(first.ref);

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

  it("keeps what a graph gates its notes by in the folder it is in", async () => {
    const held = device();
    const graph = await held.api.createGraph({ title: "Thesis" });
    expect(graph.ownership).toBeUndefined();
    const gated = await held.api.updateGraph(graph.ref, {
      title: "Thesis",
      ownership: "owned",
    });
    expect(gated.ownership).toBe("owned");
    expect((await reopened(held).listGraphs())[0].ownership).toBe("owned");
  });

  it("keeps the owner's name and picture with every graph on the device", async () => {
    const held = device(["/graphs/one", "/graphs/two"]);
    await held.api.createGraph({ title: "Thesis" });
    await held.api.createGraph({ title: "Garden" });
    const ticket = await held.api.createUpload({
      role: "avatar",
      filename: "ada.png",
      mime_type: "image/png",
      size: 1,
    });
    await held.files
      .at("/graphs/one")
      .write(`media/${ticket.upload_id}.png`, new Uint8Array([7]));
    await held.api.completeUpload({ upload_id: ticket.upload_id });

    const said = await held.api.updateProfile({
      display_name: "Ada Lovelace",
      avatar_upload_id: ticket.upload_id,
    });
    expect(said.display_name).toBe("Ada Lovelace");
    expect(said.avatar_src).not.toBeNull();
    for (const root of ["/graphs/one", "/graphs/two"]) {
      const file = held.store.get(`${root}/${GRAPH_FILE}`);
      const graph = JSON.parse(decodeText(file ?? new Uint8Array()));
      expect(graph.owner_name).toBe("Ada Lovelace");
      expect(held.store.has(`${root}/${graph.owner_avatar}`)).toBe(true);
    }

    const again = reopened(held);
    expect((await again.profile()).display_name).toBe("Ada Lovelace");
    await again.updateProfile({ display_name: null, avatar_upload_id: null });
    const off = await reopened(held).profile();
    expect(off.display_name).toBeNull();
    expect(off.avatar_src).toBeNull();
    expect(
      [...held.store.keys()].filter((path) => path.includes("/media/")),
    ).toEqual([]);
  });

  it("names whoever owns a folder to whoever else reads it", async () => {
    const held = device(["/graphs/one"]);
    await held.api.createGraph({ title: "Thesis" });
    await held.api.updateProfile({ display_name: "Ada Lovelace" });
    const owner = (await held.api.me())?.did as string;

    const reading = reopened(held);
    expect((await reading.profileOf(owner)).display_name).toBe("Ada Lovelace");
    await expect(
      reading.profileOf("did:syr:z6MkNobodyOnThisDevice"),
    ).rejects.toBeInstanceOf(ServerRequiredError);
  });

  it("says a graph on this device holds no more of you than that", async () => {
    const held = device();
    await held.api.createGraph({ title: "Thesis" });
    await expect(
      held.api.updateProfile({ bio: "I count things." }),
    ).rejects.toThrow("nothing else about you");
    expect((await held.api.profile()).did).toMatch(/^did:syr:/);
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
