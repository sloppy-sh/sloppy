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
  parseNode,
  recordIdFromOwnedRef,
  type SnapshotAsset,
} from "@sloppy/types";
import { describe, expect, it } from "vitest";
import type { BlockRepository } from "../block/block.repository";
import type { MediaService } from "../media/media.service";
import type { NodeRepository } from "../node/node.repository";
import type { Delegation, SyrService } from "../syr/syr.service";
import type { PublicationRepository } from "./publication.repository";
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
  chainsRemoved: OwnedRef[];
  assetsRemoved: number;
}

/**
 * A publish of one note carrying one picture, where `refusing` decides whether
 * the store accepts the row that pairs the copy with the picture it came from.
 */
function publishing(of: { held?: Publication; refusing: boolean }): {
  service: PublicationService;
  ledger: Ledger;
} {
  const ledger: Ledger = {
    released: [],
    chainsRemoved: [],
    assetsRemoved: 0,
  };
  const chain: Publication = of.held ?? {
    id: recordIdFromOwnedRef("publication", CHAIN),
    created_by: AVA,
    root: ROOT,
    root_address: "1" as Address,
    comments: "anyone",
    created_at: NOW,
    updated_at: NOW,
  };

  const publications = {
    async findByRoot() {
      return of.held ?? null;
    },
    async create() {
      return chain;
    },
    async assetsOf(): Promise<SnapshotAsset[]> {
      return [];
    },
    async addAsset() {
      if (of.refusing) throw new Error("that pairing is already taken");
    },
    async addNodes() {},
    async addBlocks() {},
    async nextSequence() {
      return 1;
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

  it("leaves a chain that was already there, versions and all", async () => {
    const held: Publication = {
      id: recordIdFromOwnedRef("publication", CHAIN),
      created_by: AVA,
      root: ROOT,
      root_address: "1" as Address,
      comments: "anyone",
      created_at: NOW,
      updated_at: NOW,
    };
    const { service, ledger } = publishing({ held, refusing: true });

    await expect(service.publish(delegation, { root: ROOT })).rejects.toThrow();
    expect(ledger.released).toEqual([COPY]);
    expect(ledger.chainsRemoved).toEqual([]);
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
