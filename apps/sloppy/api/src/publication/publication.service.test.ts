// What a publish that fails leaves behind. The bytes of a copy go public before
// anything that could refuse it has run, so this is where the milestone's cost
// is paid: a picture left public by an act that did not finish is a disclosure
// its author never agreed to. docs/ARCHITECTURE.md § "Pictures".

import {
  type Address,
  type Block,
  type DidSyr,
  type Node,
  type OwnedRef,
  ownedRefFrom,
  type Publication,
  type PublicationVersion,
  parseNode,
  recordIdFromOwnedRef,
  type SnapshotAsset,
  type SnapshotNode,
} from "@sloppy/types";
import { describe, expect, it } from "vitest";
import type { BlockRepository } from "../block/block.repository";
import type { MediaService } from "../media/media.service";
import type { NodeRepository } from "../node/node.repository";
import type { Delegation, SyrService } from "../syr/syr.service";
import type {
  FiledNote,
  PublicationRepository,
} from "./publication.repository";
import { PublicationService } from "./publication.service";

const AVA =
  "did:syr:z6MkuVRBZ1913zrZgc4nnA3Zs9MEEf84VUN8kgTD6QoqNiu9" as DidSyr;
const ref = (name: string): OwnedRef =>
  `${AVA}/${name.padEnd(26, "0")}` as OwnedRef;

const ROOT = ref("RT");
const SECTION = ref("SC");
const CHAIN = ref("CH");
const PICTURE = `${AVA}/PC${"0".repeat(24)}`;
const COPY = `${AVA}/CP${"0".repeat(24)}`;
const NOW = "2026-01-01T00:00:00.000Z";

const delegation: Delegation = {
  did: AVA,
  syr_instance_url: "https://example.invalid",
  delegate_public_key: "zKey",
  access_token: "a-token",
};

const root: Node = parseNode({
  id: recordIdFromOwnedRef("node", ROOT),
  created_by: AVA,
  address: "1" as Address,
  depth: 1,
  origin: ROOT,
  title: "With a picture",
  tags: [],
  links: [],
  published: false,
  created_at: NOW,
  updated_at: NOW,
});

/** A chain this root already publishes into, so a publish of it is a second
 *  version rather than the first. */
const HELD: Publication = {
  id: recordIdFromOwnedRef("publication", CHAIN),
  created_by: AVA,
  root: ROOT,
  root_address: "1" as Address,
  comments: "anyone",
  created_at: NOW,
  updated_at: NOW,
};

const section: Block = {
  id: recordIdFromOwnedRef("block", SECTION),
  created_by: AVA,
  node: ROOT,
  ord: "a0",
  content: {
    type: "doc",
    content: [{ type: "picture", attrs: { upload_id: PICTURE } }],
  },
  created_at: NOW,
  updated_at: NOW,
};

interface Ledger {
  released: string[];
  /** Where the author's identity answered from, as this publish recorded it. */
  identityStore?: string;
  /** The label the publish restated the branch under. */
  rootAddress?: Address;
  chainsRemoved: OwnedRef[];
  assetsRemoved: number;
  copying: number;
  atOnce: number;
  /** The old addresses the version filed for the note it published. */
  aliasesSent?: readonly Address[];
}

/**
 * A publish of one note carrying one picture, where `refusing` decides whether
 * the store accepts the row that pairs the copy with the picture it came from,
 * and `raced` stands for a publish in another process committing a version of
 * the same chain while this one runs.
 */
function publishing(of: {
  held?: Publication;
  refusing: boolean;
  raced?: boolean;
  holding?: Promise<void>;
  /** Addresses the root has been carried away from. */
  left?: Address[];
}): {
  service: PublicationService;
  ledger: Ledger;
} {
  const ledger: Ledger = {
    released: [],
    chainsRemoved: [],
    assetsRemoved: 0,
    copying: 0,
    atOnce: 0,
  };
  const chain: Publication = of.held ?? HELD;

  let asked = 0;
  const publications = {
    async findByRoot() {
      return of.held ?? null;
    },
    async create() {
      return chain;
    },
    async restate(
      _did: string,
      _ref: OwnedRef,
      now: { identityStore: string; address: Address | undefined },
    ) {
      ledger.identityStore = now.identityStore;
      ledger.rootAddress = now.address;
    },
    async assetsOf(): Promise<SnapshotAsset[]> {
      return [];
    },
    async addAsset() {
      if (of.refusing) throw new Error("that pairing is already taken");
    },
    async aliasesOf() {
      return new Map(of.left === undefined ? [] : [[ROOT, of.left]]);
    },
    async addNodes(rows: readonly SnapshotNode[]) {
      ledger.aliasesSent = rows[0]?.node.aliases;
    },
    async addBlocks() {},
    async nextSequence() {
      asked += 1;
      return of.raced === true && asked > 1 ? 2 : 1;
    },
    async commit() {},
    async removeAssets(ids: readonly unknown[]) {
      ledger.assetsRemoved += ids.length;
    },
    async discardVersion() {},
    async removeEmptyChain(_did: string, asked: OwnedRef) {
      ledger.chainsRemoved.push(asked);
    },
  } as unknown as PublicationRepository;

  const nodes = {
    async find() {
      return root;
    },
    async subtree() {
      return [root];
    },
    async many() {
      return [];
    },
  } as unknown as NodeRepository;

  const blocks = {
    async listByNodes() {
      return new Map([[ROOT, [section]]]);
    },
  } as unknown as BlockRepository;

  const media = {
    async ownStoredPicture() {
      return { url: "https://example.invalid/p.png", filename: "p.png" };
    },
    async copyForPublication() {
      ledger.copying += 1;
      ledger.atOnce = Math.max(ledger.atOnce, ledger.copying);
      await of.holding;
      ledger.copying -= 1;
      return { upload_id: COPY };
    },
    async removePublishedCopy(_delegation: Delegation, uploadId: string) {
      ledger.released.push(uploadId);
    },
  } as unknown as MediaService;

  const syr = {
    async listOwnEmoji() {
      return [];
    },
  } as unknown as SyrService;

  return {
    service: new PublicationService(publications, nodes, blocks, media, syr),
    ledger,
  };
}

describe("a publish that does not finish", () => {
  it("takes back a copy whose pairing row was refused", async () => {
    const { service, ledger } = publishing({ refusing: true });

    await expect(service.publish(delegation, { root: ROOT })).rejects.toThrow();
    // The bytes were public from before the row was asked for, so the undo has
    // to know about them without one.
    expect(ledger.released).toEqual([COPY]);
    expect(ledger.assetsRemoved).toBe(1);
  });

  it("takes back the chain it opened", async () => {
    const { service, ledger } = publishing({ refusing: true });

    await expect(service.publish(delegation, { root: ROOT })).rejects.toThrow();
    expect(ledger.chainsRemoved).toEqual([CHAIN]);
  });

  // A pointer names an identity and never a place, so a deposit is resolved
  // through the author's own instance and this is where it is written down.
  it("records where the author's identity answered from", async () => {
    const { service, ledger } = publishing({ held: HELD, refusing: true });

    await expect(service.publish(delegation, { root: ROOT })).rejects.toThrow();
    expect(ledger.identityStore).toBe(delegation.syr_instance_url);
  });

  it("leaves a chain that was already there, versions and all", async () => {
    const { service, ledger } = publishing({ held: HELD, refusing: true });

    await expect(service.publish(delegation, { root: ROOT })).rejects.toThrow();
    expect(ledger.released).toEqual([COPY]);
    expect(ledger.chainsRemoved).toEqual([]);
  });

  // Publishing again reuses the copies the chain already owns, so a publish
  // that fails is not free to take back what one that finished is citing: a
  // version is immutable, and a peer is reading it.
  it("leaves a copy a version published meanwhile was written around", async () => {
    const { service, ledger } = publishing({
      held: HELD,
      refusing: true,
      raced: true,
    });

    await expect(service.publish(delegation, { root: ROOT })).rejects.toThrow();
    expect(ledger.released).toEqual([]);
    expect(ledger.assetsRemoved).toBe(0);
    expect(ledger.chainsRemoved).toEqual([]);
  });

  it("publishes one branch twice over one at a time", async () => {
    let release = () => {};
    const holding = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { service, ledger } = publishing({ refusing: false, holding });

    const both = Promise.all([
      service.publish(delegation, { root: ROOT }),
      service.publish(delegation, { root: ROOT }),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ledger.copying).toBe(1);

    release();
    await both;
    expect(ledger.atOnce).toBe(1);
  });

  it("leaves the copy and the chain alone when it finishes", async () => {
    const { service, ledger } = publishing({ refusing: false });

    const view = await service.publish(delegation, { root: ROOT });
    expect(view.ref).toBe(
      ownedRefFrom(recordIdFromOwnedRef("publication", CHAIN)),
    );
    expect(view.latest.sequence).toBe(1);
    expect(ledger.released).toEqual([]);
    expect(ledger.chainsRemoved).toEqual([]);
  });
});

// A publication covers one branch, and an address the note held elsewhere in
// the author's graph is a number in a part of it nobody published —
// docs/ARCHITECTURE.md § "A published node carries only refs a peer may follow".
describe("the old addresses a version files", () => {
  it("sends the ones inside the branch, and none from outside it", async () => {
    const { service, ledger } = publishing({
      refusing: false,
      left: ["1c" as Address, "3a" as Address],
    });

    await service.publish(delegation, { root: ROOT });
    expect(ledger.aliasesSent).toEqual(["1c"]);
  });

  it("says nothing of old addresses for a note that has never moved", async () => {
    const { service, ledger } = publishing({ refusing: false });

    await service.publish(delegation, { root: ROOT });
    expect(ledger.aliasesSent).toBeUndefined();
  });
});

const VERSION = ref("VR");

const version: PublicationVersion = {
  id: recordIdFromOwnedRef("publication_version", VERSION),
  created_by: AVA,
  publication: CHAIN,
  sequence: 1,
  created_at: NOW,
  updated_at: NOW,
};

/** A note the branch holds now, as the store hands it over. */
function noteAt(name: string, address: string, title: string): Node {
  return parseNode({
    id: recordIdFromOwnedRef("node", ref(name)),
    created_by: AVA,
    address: address as Address,
    depth: address.length,
    origin: ROOT,
    title,
    tags: [],
    links: [],
    published: true,
    created_at: NOW,
    updated_at: NOW,
  });
}

/** What the newest version says about the branch, against what it holds now. */
function comparing(of: {
  filed: readonly FiledNote[];
  branch: readonly Node[];
}): PublicationService {
  const publications = {
    async find() {
      return HELD;
    },
    async latestOf() {
      return new Map([[CHAIN, version]]);
    },
    async notesIn(): Promise<FiledNote[]> {
      return [...of.filed];
    },
  } as unknown as PublicationRepository;

  const nodes = {
    async find() {
      return of.branch[0];
    },
    async subtree() {
      return [...of.branch];
    },
  } as unknown as NodeRepository;

  const blocks = {
    async writtenSince() {
      return new Set<OwnedRef>();
    },
  } as unknown as BlockRepository;

  return new PublicationService(
    publications,
    nodes,
    blocks,
    {} as unknown as MediaService,
    {} as unknown as SyrService,
  );
}

describe("what a branch has done since it was last published", () => {
  const filed = (
    name: string,
    address: string,
    title: string,
    at = 0,
  ): FiledNote => ({
    source: ref(name),
    ord: String(at).padStart(8, "0"),
    address: address as Address,
    title,
    tags: [],
  });

  it("names a note carried somewhere else inside the branch", async () => {
    const service = comparing({
      filed: [filed("RT", "1", "Root"), filed("NA", "1a", "Spores")],
      branch: [noteAt("RT", "1", "Root"), noteAt("NA", "1c", "Spores")],
    });

    const { changes, total } = await service.unpublished(AVA, CHAIN);

    expect(total).toBe(1);
    expect(changes[0]).toMatchObject({
      note: ref("NA"),
      address: "1c",
      was_at: "1a",
      title: "Spores",
      change: "changed",
      written: false,
    });
  });

  it("says nothing of where a note was when it has not been carried", async () => {
    const service = comparing({
      filed: [filed("RT", "1", "Root"), filed("NA", "1a", "Seeds")],
      branch: [noteAt("RT", "1", "Root"), noteAt("NA", "1a", "Spores")],
    });

    const { changes } = await service.unpublished(AVA, CHAIN);

    expect(changes[0]).toMatchObject({ was_titled: "Seeds" });
    expect(changes[0].was_at).toBeUndefined();
  });

  it("says nothing of a branch nothing has happened to", async () => {
    const service = comparing({
      filed: [filed("RT", "1", "Root"), filed("NA", "1a", "Spores")],
      branch: [noteAt("RT", "1", "Root"), noteAt("NA", "1a", "Spores")],
    });

    expect((await service.unpublished(AVA, CHAIN)).changes).toEqual([]);
  });
});
