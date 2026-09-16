// The archive one graph is written out as, read back with the same reader an
// import uses. What the two disagree about is what the trip loses.

import {
  type Address,
  type Block,
  createOwnedRecordId,
  type DidSyr,
  type Node,
  type OwnedRef,
} from "@sloppy/types";
import {
  GRAPH_FILE,
  mediaPath,
  readGraphFile,
  unpack,
  VAULT_FORMAT,
} from "@sloppy/vault";
import { describe, expect, it } from "vitest";
import {
  ArchiveExportService,
  fileName,
  vaultName,
} from "./archive-export.service";
import { readNotes } from "./archive-import.service";

const DID = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva" as DidSyr;
const GRAPH: OwnedRef = `${DID}/01JGRAPH2ND000000000000000`;
const HOME: OwnedRef = `${DID}/01JNKTE0000000000000000001`;
const UNDER: OwnedRef = `${DID}/01JNKTE0000000000000000002`;
const UPLOAD = `${DID}/01JPICTURE00000000000000AB`;
const PIXEL = new Uint8Array([137, 80, 78, 71]);

function node(ref: OwnedRef, over: Partial<Node> = {}): Node {
  return {
    id: createOwnedRecordId("node", DID, ref.slice(DID.length + 1)),
    created_by: DID,
    graph: GRAPH,
    depth: 1,
    origin: ref,
    title: "",
    tags: [],
    links: [],
    published: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    ...over,
  };
}

function block(node: OwnedRef, ulid: string, content: unknown): Block {
  return {
    id: createOwnedRecordId("block", DID, ulid),
    created_by: DID,
    node,
    ord: "a0",
    content: content as Block["content"],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

const INK = { strokes: [{ points: [1, 2, 3, 4] }], width: 600, height: 200 };

const WRITING = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "The city " },
        {
          type: "text",
          text: "remembers",
          marks: [{ type: "link", attrs: { href: "https://example.org/" } }],
        },
        { type: "text", text: " what " },
        { type: "reference", attrs: { note: UNDER } },
        { type: "text", text: " forgot, at " },
        { type: "mathInline", attrs: { tex: "e^{i\\pi}" } },
      ],
    },
    { type: "mathBlock", attrs: { tex: "a^2 + b^2 = c^2" } },
    {
      type: "diagram",
      attrs: { language: "mermaid", source: "graph TD;\n  a-->b;" },
    },
    { type: "picture", attrs: { upload_id: UPLOAD, width: 8, height: 6 } },
    { type: "ink", attrs: INK },
  ],
};

/** Everything the builder reads, with nothing behind it but these answers. */
function serving(pictures = true) {
  const asked: string[] = [];
  const service = new ArchiveExportService(
    {
      requireHeld: async () => undefined,
      list: async () => [{ ref: GRAPH, title: "The garden" }],
    } as never,
    {
      notesIn: async () => [HOME, UNDER],
      many: async () => [
        node(HOME, { address: "1" as Address, title: "A city remembers" }),
        node(UNDER, {
          address: "1a" as Address,
          parent: HOME,
          origin: HOME,
          depth: 2,
          title: "Under it",
          tags: ["biology"],
          links: [HOME],
        }),
      ],
      aliasesOf: async () => new Map([[UNDER, ["1b" as Address]]]),
    } as never,
    {
      listByNodes: async () =>
        new Map([
          [HOME, [block(HOME, "01JSECTAKN0000000000000001", WRITING)]],
          [UNDER, []],
        ]),
    } as never,
    { listFor: async () => [] } as never,
    {
      readOwnPicture: async (_delegation: unknown, uploadId: string) => {
        asked.push(uploadId);
        if (!pictures) throw new Error("that picture is not there");
        return { bytes: PIXEL, mimeType: "image/png", filename: "tree.png" };
      },
    } as never,
    { listOwnEmoji: async () => [] } as never,
    {
      localIdpEnabled: false,
      isProduction: false,
      publicUrl: "http://x",
    } as never,
  );
  return { asked, service };
}

const delegation = { did: DID, access_token: "t" } as never;

describe("a graph written out as an archive", () => {
  it("says whose graph it is and which one, without the identity's name in a file", async () => {
    const { service } = serving();

    const archive = await service.archive(delegation, DID, GRAPH);
    const vault = unpack(archive.bytes);

    expect(readGraphFile(vault.get(GRAPH_FILE) as Uint8Array)).toEqual({
      format: VAULT_FORMAT,
      graph: "01JGRAPH2ND000000000000000",
      name: "The garden",
      owner: DID,
    });
    expect(vault.has(mediaPath("01JPICTURE00000000000000AB", "png"))).toBe(
      true,
    );
  });

  it("is the same bytes twice, so nothing changing looks like nothing changing", async () => {
    const first = await serving().service.archive(delegation, DID, GRAPH);
    const second = await serving().service.archive(delegation, DID, GRAPH);

    expect(Buffer.from(first.bytes).equals(Buffer.from(second.bytes))).toBe(
      true,
    );
  });

  it("reads back as the writing it was, with the picture named inside the vault", async () => {
    const { service } = serving();

    const archive = await service.archive(delegation, DID, GRAPH);
    const [first, second] = readNotes(unpack(archive.bytes)).sort((a, b) =>
      a.ref < b.ref ? -1 : 1,
    );

    expect(first.ref).toBe(HOME);
    expect(first.address).toBe("1");
    expect(first.title).toBe("A city remembers");
    expect(first.sections).toHaveLength(1);
    expect(first.sections[0].ulid).toBe("01JSECTAKN0000000000000001");
    expect(first.sections[0].content).toEqual({
      ...WRITING,
      content: WRITING.content.map((element) =>
        element.type === "picture"
          ? {
              type: "picture",
              attrs: {
                upload_id: "01JPICTURE00000000000000AB",
                width: 8,
                height: 6,
              },
            }
          : element,
      ),
    });
    expect(second.address).toBe("1a");
    expect(second.aliases).toEqual(["1b"]);
    expect(second.parent).toBe(HOME);
    expect(second.tags).toEqual(["biology"]);
    expect(second.links).toEqual([HOME]);
  });

  it("keeps the note whole when a picture's bytes are no longer there", async () => {
    const { asked, service } = serving(false);

    const archive = await service.archive(delegation, DID, GRAPH);
    const vault = unpack(archive.bytes);
    const [first] = readNotes(vault);

    expect(asked).toEqual([UPLOAD]);
    expect([...vault.keys()].some((path) => path.startsWith("media/"))).toBe(
      false,
    );
    expect(first.sections[0].content).toEqual(WRITING);
  });
});

describe("what one upload's file is called inside a vault", () => {
  it("is the half of the id that is not the identity leaving", () => {
    expect(vaultName(UPLOAD, DID)).toBe("01JPICTURE00000000000000AB");
  });

  it("is absent for somebody else's picture, and for a name a path cannot hold", () => {
    expect(vaultName(`did:syr:z6Mk9/01A`, DID)).toBeUndefined();
    expect(vaultName(`${DID}/../escape`, DID)).toBeUndefined();
    expect(vaultName(`${DID}/`, DID)).toBeUndefined();
  });
});

describe("what the downloaded file is called", () => {
  it("names the graph and the day", () => {
    expect(fileName("The garden", new Date("2026-09-09T10:00:00Z"))).toBe(
      "The garden 2026-09-09.sloppy",
    );
  });

  it("still names the day for a graph whose title is nothing a file can hold", () => {
    expect(fileName("/../", new Date("2026-09-09T10:00:00Z"))).toBe(
      "graph 2026-09-09.sloppy",
    );
  });
});
