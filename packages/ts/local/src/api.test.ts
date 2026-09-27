import { ServerRequiredError, type SloppyApi } from "@sloppy/client";
import {
  type BlockDocument,
  type DidSyr,
  UNNAMED_GRAPH_ULID,
  splitOwnedRef,
} from "@sloppy/types";
import { GRAPH_FILE, decodeText, encodeText, notePath } from "@sloppy/vault";
import { describe, expect, it } from "vitest";
import { LocalApi } from "./api.js";
import { MemoryFiles } from "./files.js";
import {
  PickingFiles,
  body,
  device,
  reopened,
  textDocument,
} from "./local.test-support.js";

/** Somebody writing in a folder that is not theirs. */
const GUEST = "did:syr:z6MkGuestWritingHere" as DidSyr;

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

  // The container sits inside somebody's repository, so a key minted there is a
  // key committed unless the history is told to pass over it — and only
  // `sloppy init` used to tell it.
  it("tells a project's history to pass over its keys, however the container arrived", async () => {
    const held = opened("/Users/me/code");
    await held.api.openProject("/Users/me/code");

    const ignore = held.store.get("/Users/me/code/.sloppy/.gitignore");
    expect(ignore).toBeDefined();
    const lines = new TextDecoder().decode(ignore).split("\n");
    expect(lines).toContain("*.key");
    expect(lines).toContain("identities.json");
    // What somebody hands the chat is theirs and this device's: a photo taken
    // to ask a question about it is not a note, and committing it puts it
    // somewhere they cannot take it back from.
    expect(lines).toContain("/attached/");
  });

  it("adds the missing lines to a container that already had none", async () => {
    const store = new Map<string, Uint8Array>();
    store.set(
      "/Users/me/old/.sloppy/.gitignore",
      new TextEncoder().encode("notes-i-wrote-myself\n"),
    );
    const held = opened("/Users/me/old", store);
    await held.api.openProject("/Users/me/old");

    const lines = new TextDecoder()
      .decode(held.store.get("/Users/me/old/.sloppy/.gitignore"))
      .split("\n");
    // What somebody wrote themselves stays theirs.
    expect(lines).toContain("notes-i-wrote-myself");
    expect(lines).toContain("*.key");
  });

  // The tool that writes the notes is told to read this before anything else,
  // and a container the app started never had one.
  it("leaves an agent what it needs to read, however the container arrived", async () => {
    const held = opened("/Users/me/code");
    await held.api.openProject("/Users/me/code");

    const agent = held.store.get("/Users/me/code/.sloppy/AGENT.md");
    expect(agent).toBeDefined();
    const said = new TextDecoder().decode(agent);
    expect(said).toContain("compass");
    expect(said).toContain("tags");
  });

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

  it("is the one row a graph gets where a second folder holds it too", async () => {
    const first = opened("/Users/me/garden");
    await first.api.createNode({ title: "A first thought" });
    for (const [path, bytes] of [...first.store]) {
      if (!path.startsWith("/Users/me/garden/")) continue;
      first.store.set(
        path.replace("/Users/me/garden/", "/Users/me/backup/"),
        bytes,
      );
    }

    const again = opened("/Users/me/backup", first.store);
    const here = await again.api.graphHere();
    await again.api.updateGraph(here, { title: "The backup" });

    const listed = await again.api.listGraphs();

    expect(listed.map((one) => one.ref)).toEqual([here]);
    expect(listed[0].title).toBe("The backup");
    expect(
      decodeText(
        again.store.get(`/Users/me/garden/${GRAPH_FILE}`) as Uint8Array,
      ),
    ).not.toContain("The backup");
  });

  it("is the folder a note is read out of and written back into", async () => {
    const first = opened("/Users/me/garden");
    const note = await first.api.createNode({ title: "A first thought" });
    for (const [path, bytes] of [...first.store]) {
      if (!path.startsWith("/Users/me/garden/")) continue;
      first.store.set(
        path.replace("/Users/me/garden/", "/Users/me/backup/"),
        bytes,
      );
    }

    const again = opened("/Users/me/backup", first.store);
    await again.api.updateNode(note.ref, { title: "Written here" });

    const file = notePath(splitOwnedRef(note.ref).localId);
    expect(
      decodeText(again.store.get(`/Users/me/backup/${file}`) as Uint8Array),
    ).toContain("Written here");
    expect(
      decodeText(again.store.get(`/Users/me/garden/${file}`) as Uint8Array),
    ).toContain("A first thought");
    expect((await again.api.getNode(note.ref))?.title).toBe("Written here");
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

  it("keeps what a graph asks of a writer in the folder it is in", async () => {
    const held = device();
    const graph = await held.api.createGraph({ title: "Thesis" });
    expect(graph.vouching).toBeUndefined();
    const asking = await held.api.updateGraph(graph.ref, {
      title: "Thesis",
      vouching: "required",
    });
    expect(asking.vouching).toBe("required");
    expect((await reopened(held).listGraphs())[0].vouching).toBe("required");
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

  it("is not closed by somebody who only writes in it", async () => {
    const held = device();
    const graph = await held.api.createGraph({ title: "Thesis" });
    await held.api.updateProfile({ display_name: "Ada Lovelace" });
    const guest = new LocalApi(new PickingFiles({ store: held.store }), {
      writer: GUEST,
    });

    await expect(guest.closeGraph(graph.ref)).rejects.toThrow(
      "This graph is Ada Lovelace's. Only they can close it.",
    );
    expect(held.store.has(`/graphs/one/${GRAPH_FILE}`)).toBe(true);
  });

  it("says a folder is somebody else's even where it does not say who", async () => {
    const held = device();
    const graph = await held.api.createGraph({ title: "Thesis" });
    const guest = new LocalApi(new PickingFiles({ store: held.store }), {
      writer: GUEST,
    });

    await expect(guest.closeGraph(graph.ref)).rejects.toThrow(
      "This graph is somebody else's. Only its owner can close it.",
    );
  });

  it("leaves the picture a folder already carries where it is", async () => {
    const held = device();
    await held.api.createGraph({ title: "Thesis" });
    const wearing = new Uint8Array([7, 7, 7]);
    const worn = async () => {
      const ticket = await held.api.createUpload({
        role: "avatar",
        filename: "picture",
        mime_type: "image/png",
        size: wearing.byteLength,
      });
      await held.api.sendUpload(ticket, body(wearing));
      await held.api.completeUpload({ upload_id: ticket.upload_id });
      await held.api.updateProfile({
        display_name: "Ada Lovelace",
        avatar_upload_id: ticket.upload_id,
      });
      return JSON.parse(
        decodeText(
          held.store.get(`/graphs/one/${GRAPH_FILE}`) ?? new Uint8Array(),
        ),
      ).owner_avatar as string;
    };

    const first = await worn();
    // The same picture carried in again, as a second sign-in carries it.
    expect(await worn()).toBe(first);
    expect(
      [...held.store.keys()].filter((path) => path.includes("/media/")),
    ).toEqual([`/graphs/one/${first}`]);
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

// The terminal writes the same files, and a shell that has been reading them is
// holding an index of what they said when it opened.
describe("a section saved into a folder written in elsewhere", () => {
  const said = (block: { content: BlockDocument }): string =>
    JSON.stringify(block.content);

  async function opened() {
    const held = device();
    await held.api.createGraph({ title: "Thesis" });
    const note = await held.api.createNode({ title: "Seeds" });
    const section = await held.api.createBlock({
      node: note.ref,
      content: textDocument("A seed keeps its own clock."),
    });
    // Read once, so this client is holding the folder as it was.
    await held.api.listBlocks(note.ref);
    return { held, note, section };
  }

  it("leaves the section somebody else added where it is", async () => {
    const { held, note, section } = await opened();
    await reopened(held).createBlock({
      node: note.ref,
      content: textDocument("What the terminal added."),
    });

    await held.api.updateBlock(section.ref, {
      content: textDocument("What I wrote."),
    });

    expect((await reopened(held).listBlocks(note.ref)).map(said)).toEqual([
      said({ content: textDocument("What the terminal added.") }),
      said({ content: textDocument("What I wrote.") }),
    ]);
  });

  it("refuses a write over a section written somewhere else in between", async () => {
    const { held, note, section } = await opened();
    // A section's stamp is the note file's own, written to the millisecond.
    await new Promise((later) => setTimeout(later, 2));
    await reopened(held).updateBlock(section.ref, {
      content: textDocument("What the terminal wrote."),
    });

    await expect(
      held.api.updateBlock(section.ref, {
        content: textDocument("What I wrote."),
        expects: section.updated_at,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await reopened(held).listBlocks(note.ref)).map(said)).toEqual([
      said({ content: textDocument("What the terminal wrote.") }),
    ]);
  });

  it("says a section the note no longer holds is gone rather than writing it back", async () => {
    const { held, note, section } = await opened();
    await reopened(held).deleteBlock(section.ref);

    await expect(
      held.api.updateBlock(section.ref, {
        content: textDocument("What I wrote."),
      }),
    ).rejects.toMatchObject({ status: 410 });
    expect(await reopened(held).listBlocks(note.ref)).toEqual([]);
  });
});
