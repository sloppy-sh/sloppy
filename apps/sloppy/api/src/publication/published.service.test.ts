// What a peer's instance gets back when it follows a version to the end. The
// bound that matters is not one page's size but how many pages a region takes:
// `publishedSubtreeReader` stops at MAX_PUBLISHED_PAGES, so a version that
// serves too few notes per answer cannot be read back at all.

import {
  type Address,
  type DidSyr,
  childAddress,
  homeGraphRef,
  MAX_PUBLISHED_PAGES,
  type OwnedRef,
  type Publication,
  type PublicationVersion,
  parseSnapshotNode,
  publishedSubtreeReader,
  recordIdFromOwnedRef,
  siblingAddress,
  type SnapshotBlock,
  SnapshotBlockSchema,
  type SnapshotNode,
} from "@sloppy/types";
import { describe, expect, it } from "vitest";
import type { PublicationRepository } from "./publication.repository";
import { PublishedService } from "./published.service";

const AVA =
  "did:syr:z6MkuVRBZ1913zrZgc4nnA3Zs9MEEf84VUN8kgTD6QoqNiu9" as DidSyr;
const ref = (name: string): OwnedRef =>
  `${AVA}/${name.padEnd(26, "0")}` as OwnedRef;
/** Fixed width, so two counts never pad into one reference. */
const tag = (at: number) => String(at).padStart(6, "0");

const PUBLICATION = ref("PB");
const VERSION = ref("VR");
const NOW = "2026-01-01T00:00:00.000Z";
/** What this author calls the notebook the chain below is read in. */
const NOTEBOOK = "The garden";

interface Snapshot {
  nodes: SnapshotNode[];
  blocks: SnapshotBlock[];
}

/**
 * A version of `notes` notes, each carrying `sections` sections, all springing
 * from one root. Addresses are strings to everything that reads them, so the
 * run is ordered here the way SurrealDB orders it.
 */
function version(of: { notes: number; sections: number }): Snapshot {
  const nodes: SnapshotNode[] = [];
  const blocks: SnapshotBlock[] = [];
  const root = ref("RT");
  const rootAddress = "1" as Address;

  const note = (source: OwnedRef, address: Address, parent?: OwnedRef) =>
    parseSnapshotNode({
      id: recordIdFromOwnedRef("snapshot_node", source),
      created_by: AVA,
      version: VERSION,
      source,
      address,
      node: {
        address,
        ...(parent === undefined ? {} : { parent }),
        origin: root,
        title: `Note at ${address}`,
        tags: [],
        links: [],
        created_at: NOW,
        updated_at: NOW,
      },
      created_at: NOW,
      updated_at: NOW,
    });

  const stack = (node: OwnedRef, at: number) => {
    for (let i = 0; i < of.sections; i++) {
      const source = ref(`S${tag(at)}X${tag(i)}`);
      blocks.push(
        SnapshotBlockSchema.parse({
          id: recordIdFromOwnedRef("snapshot_block", source),
          created_by: AVA,
          version: VERSION,
          source,
          node,
          ord: String(i).padStart(6, "0"),
          content: {
            type: "doc",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "It." }] },
            ],
          },
          created_at: NOW,
          updated_at: NOW,
        }),
      );
    }
  };

  nodes.push(note(root, rootAddress));
  stack(root, 0);
  let address = childAddress(rootAddress);
  for (let at = 1; at < of.notes; at++) {
    const source = ref(`N${tag(at)}`);
    nodes.push(note(source, address, root));
    stack(source, at);
    address = siblingAddress(address);
  }
  return { nodes, blocks };
}

/** One version's rows in the orders the repository reads them back in. */
interface Held {
  ordered: SnapshotNode[];
  stacks: Map<OwnedRef, SnapshotBlock[]>;
}

function hold(held: Snapshot): Held {
  const ordered = [...held.nodes].sort((a, b) =>
    a.address < b.address ? -1 : a.address > b.address ? 1 : 0,
  );
  const stacks = new Map<OwnedRef, SnapshotBlock[]>();
  for (const block of held.blocks) {
    const stack = stacks.get(block.node);
    if (stack) stack.push(block);
    else stacks.set(block.node, [block]);
  }
  for (const stack of stacks.values()) {
    stack.sort((a, b) => (a.ord < b.ord ? -1 : a.ord > b.ord ? 1 : 0));
  }
  return { ordered, stacks };
}

/**
 * The reads `PublishedService` makes, answered from memory in the repository's
 * own orders: notes by address, sections by note reference and then by `ord`.
 * A read past its limit is TRUNCATED rather than refused, which is the shape
 * the service has to notice.
 *
 * `publish` adds a version and makes it the newest, which is what an author
 * publishing again while a peer reads looks like from down here.
 */
function repositoryOf(first: Snapshot): {
  repository: PublicationRepository;
  publish: (next: Snapshot) => OwnedRef;
} {
  const chain: Publication = {
    id: recordIdFromOwnedRef("publication", PUBLICATION),
    created_by: AVA,
    root: ref("RT"),
    root_address: "1" as Address,
    comments: "anyone",
    created_at: NOW,
    updated_at: NOW,
  };
  const held = new Map<OwnedRef, Held>([[VERSION, hold(first)]]);
  let newest = VERSION;

  const versionRow = (at: OwnedRef): PublicationVersion => ({
    id: recordIdFromOwnedRef("publication_version", at),
    created_by: AVA,
    publication: PUBLICATION,
    sequence: [...held.keys()].indexOf(at) + 1,
    created_at: NOW,
    updated_at: NOW,
  });
  const rows = (version: OwnedRef): Held =>
    held.get(version) ?? { ordered: [], stacks: new Map() };

  const repository = {
    async find(_did: string, asked: OwnedRef) {
      return asked === PUBLICATION ? chain : null;
    },
    async latestOf(_did: string, asked: readonly OwnedRef[]) {
      return new Map(
        asked.includes(PUBLICATION) ? [[PUBLICATION, versionRow(newest)]] : [],
      );
    },
    async findVersion(_did: string, asked: OwnedRef) {
      return held.has(asked) ? versionRow(asked) : null;
    },
    async nodesFrom(
      _did: string,
      version: OwnedRef,
      after: Address | undefined,
      limit: number,
    ) {
      return rows(version)
        .ordered.filter((row) => after === undefined || row.address > after)
        .slice(0, limit);
    },
    async nodeAt(_did: string, version: OwnedRef, address: Address) {
      return (
        rows(version).ordered.find((row) => row.address === address) ?? null
      );
    },
    async blocksOf(
      _did: string,
      version: OwnedRef,
      nodes: readonly OwnedRef[],
      limit: number,
    ) {
      const { stacks } = rows(version);
      const run: SnapshotBlock[] = [];
      for (const node of [...nodes].sort()) {
        run.push(...(stacks.get(node) ?? []));
      }
      return run.slice(0, limit);
    },
    async graphTitles(_did: string, graphs: readonly OwnedRef[]) {
      return new Map(
        graphs
          .filter((of) => of === homeGraphRef(AVA))
          .map((of) => [of, NOTEBOOK]),
      );
    },
    async blocksAfter(
      _did: string,
      version: OwnedRef,
      node: OwnedRef,
      ord: string,
      limit: number,
    ) {
      return (rows(version).stacks.get(node) ?? [])
        .filter((block) => block.ord > ord)
        .slice(0, limit);
    },
  } as unknown as PublicationRepository;

  return {
    repository,
    publish(next: Snapshot) {
      const at = ref(`V${held.size + 1}`);
      held.set(at, hold(next));
      newest = at;
      return at;
    },
  };
}

/** Every page of a version, taken the way a peer's instance takes them —
 *  through the reader, which refuses an answer that moves to another version
 *  part of the way through. `between` runs once the first page is in. */
async function readThrough(
  service: PublishedService,
  between?: () => void,
): Promise<{ addresses: Address[]; sections: OwnedRef[]; pages: number }> {
  const reader = publishedSubtreeReader({ publication: PUBLICATION });
  const addresses: Address[] = [];
  const sections: OwnedRef[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = reader.take(
      await service.subtree(AVA, PUBLICATION, undefined, cursor),
    );
    pages += 1;
    if (pages === 1) between?.();
    for (const node of page.nodes) addresses.push(node.address);
    for (const block of page.blocks) sections.push(block.ref);
    cursor = page.next_cursor;
  } while (cursor !== undefined);
  return { addresses, sections, pages };
}

describe("serving one version a page at a time", () => {
  it("narrows the run when a window's sections will not fit, rather than falling to one note a page", async () => {
    const held = version({ notes: 600, sections: 12 });
    const service = new PublishedService(repositoryOf(held).repository);

    const { addresses, sections, pages } = await readThrough(service);
    expect(addresses).toHaveLength(600);
    expect(new Set(addresses).size).toBe(600);
    expect(sections).toHaveLength(600 * 12);
    // The bound a conforming reader applies. One note a page would take 600.
    expect(pages).toBeLessThan(MAX_PUBLISHED_PAGES);
  }, 30_000);

  it("pages inside a note whose stack alone runs past one read", async () => {
    const held = version({ notes: 1, sections: 2_500 });
    const service = new PublishedService(repositoryOf(held).repository);

    const { addresses, sections, pages } = await readThrough(service);
    expect(addresses).toEqual(["1"]);
    expect(new Set(sections).size).toBe(2_500);
    expect(pages).toBeGreaterThan(1);
    expect(pages).toBeLessThan(MAX_PUBLISHED_PAGES);
  });

  it("carries a version that fits in one answer whole, with no cursor", async () => {
    const held = version({ notes: 20, sections: 3 });
    const service = new PublishedService(repositoryOf(held).repository);

    const page = await service.subtree(AVA, PUBLICATION, undefined, undefined);
    expect(page?.nodes).toHaveLength(20);
    expect(page?.blocks).toHaveLength(60);
    expect(page?.next_cursor).toBeUndefined();
  });

  // A peer holding two regions of one author's graphs reads two `1a`s, and the
  // name is what tells them apart.
  it("names the notebook every address on the page is read in", async () => {
    const service = new PublishedService(
      repositoryOf(version({ notes: 2, sections: 0 })).repository,
    );

    const page = await service.subtree(AVA, PUBLICATION, undefined, undefined);
    expect(page?.graph_title).toBe(NOTEBOOK);
  });

  it("answers nothing for a publication that is not here", async () => {
    const service = new PublishedService(
      repositoryOf(version({ notes: 1, sections: 0 })).repository,
    );
    expect(
      await service.subtree(AVA, ref("ZZ"), undefined, undefined),
    ).toBeNull();
  });
});

describe("a read the author publishes over", () => {
  // The reader refuses a run that changes version under it, so a pull that
  // survives at all is a pull held to the version it opened on.
  it("carries the version it opened on to the end", async () => {
    const store = repositoryOf(version({ notes: 60, sections: 40 }));
    const service = new PublishedService(store.repository);

    const { addresses, sections, pages } = await readThrough(service, () => {
      store.publish(version({ notes: 1, sections: 1 }));
    });

    expect(pages).toBeGreaterThan(1);
    expect(addresses).toHaveLength(60);
    expect(sections).toHaveLength(60 * 40);
  });

  it("answers a read that starts afterwards with what was published last", async () => {
    const store = repositoryOf(version({ notes: 6, sections: 1 }));
    const service = new PublishedService(store.repository);

    const before = await service.subtree(
      AVA,
      PUBLICATION,
      undefined,
      undefined,
    );
    const later = store.publish(version({ notes: 1, sections: 1 }));
    const after = await service.subtree(AVA, PUBLICATION, undefined, undefined);

    expect(before?.nodes).toHaveLength(6);
    expect(before?.version.ref).not.toBe(later);
    expect(after?.version.ref).toBe(later);
    expect(after?.nodes).toHaveLength(1);
  });
});
