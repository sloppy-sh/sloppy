// Nodes, and the one thing about them that is a protocol rather than a feature:
// the address. AI.md § "The Address Is the Protocol".

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  type Address,
  addressDepth,
  type CreateNodeRequestSchema,
  createOwnedRecordId,
  entityView,
  isRootAddress,
  type Node,
  type NodeView,
  nowIso,
  type OwnedRef,
  ownedRefFrom,
  parseNode,
  type TagCount,
  type UpdateNodeRequestSchema,
} from "@sloppy/types";
import type { z } from "zod";
import { nextChildAddress } from "./address-assignment";
import { NodeRepository } from "./node.repository";
import { SerialQueue } from "./serial-queue";

type CreateRequest = z.output<typeof CreateNodeRequestSchema>;
type UpdateRequest = z.output<typeof UpdateNodeRequestSchema>;

/**
 * A writer in another process gets past the queue and is refused by the unique
 * index. The bound is what stops a pathological loop, not a tuned number.
 */
const ADDRESS_ATTEMPTS = 8;

@Injectable()
export class NodeService {
  private readonly creations = new SerialQueue();

  constructor(private readonly nodes: NodeRepository) {}

  async list(
    did: string,
    query: { origin?: OwnedRef; maxDepth?: number },
  ): Promise<NodeView[]> {
    const rows = query.origin
      ? await this.nodes.region(did, query.origin, query.maxDepth)
      : await this.nodes.roots(did);
    return rows.map(entityView);
  }

  async get(did: string, ref: OwnedRef): Promise<NodeView | null> {
    const node = await this.nodes.find(did, ref);
    return node === null ? null : entityView(node);
  }

  tags(did: string): Promise<TagCount[]> {
    return this.nodes.tagCounts(did);
  }

  async create(did: string, request: CreateRequest): Promise<NodeView> {
    const parent = await this.parentFor(did, request.from);
    const named =
      request.from?.relation === "root" ? request.from.address : null;
    const written = await this.creations.run(
      `${did}|${parent?.address ?? ""}`,
      () =>
        named === null
          ? this.write(did, parent, request)
          : this.writeAt(did, named, request),
    );
    // A note written AFTER another continues its run, so the one it follows
    // points at it — that sequence is the thing a reader walks. A note written
    // UNDER one, or opening a branch, starts something instead, and starts it
    // unlinked.
    if (request.from?.relation === "after") {
      await this.follow(did, request.from.note, written.ref);
    }
    return written;
  }

  /** Links `note` to `next`, leaving the rest of its links as they were. */
  private async follow(
    did: string,
    note: OwnedRef,
    next: OwnedRef,
  ): Promise<void> {
    const from = await this.nodes.find(did, note);
    if (!from || from.links.includes(next)) return;
    await this.nodes.patch(did, note, { links: [...from.links, next] });
  }

  async update(
    did: string,
    ref: OwnedRef,
    request: UpdateRequest,
  ): Promise<NodeView> {
    const updated = await this.nodes.patch(did, ref, request);
    if (!updated) throw new NotFoundException("That note is not here.");
    return entityView(updated);
  }

  /** A node leaves with everything that sprang from it. */
  async remove(did: string, ref: OwnedRef): Promise<void> {
    const node = await this.nodes.find(did, ref);
    if (!node) return;
    await this.nodes.remove(did, await this.nodes.subtree(did, node));
  }

  /**
   * The node the new one hangs under. A note placed `after` another takes the
   * same parent as that one, which is what makes `1a` → `1b` and `1` → `2` the
   * same act at two depths.
   */
  private async parentFor(
    did: string,
    from: CreateRequest["from"],
  ): Promise<Node | null> {
    if (!from || from.relation === "root") return null;
    const anchor = await this.nodes.find(did, from.note);
    if (!anchor) {
      throw new BadRequestException(
        from.relation === "under"
          ? "The note this springs from is not here."
          : "The note this follows is not here.",
      );
    }
    if (from.relation === "under") return anchor;
    if (!anchor.parent) return null;
    const parent = await this.nodes.find(did, anchor.parent);
    if (!parent) {
      throw new BadRequestException("The note this follows is not here.");
    }
    return parent;
  }

  /** A branch at the number its author picked, which nothing else may hold. */
  private async writeAt(
    did: string,
    address: Address,
    request: CreateRequest,
  ): Promise<NodeView> {
    if (await this.nodes.addressTaken(did, address)) throw taken(address);
    try {
      return entityView(
        await this.nodes.insert(newNode(did, address, null, request)),
      );
    } catch (err) {
      if (await this.nodes.addressTaken(did, address)) throw taken(address);
      throw err;
    }
  }

  private async write(
    did: string,
    parent: Node | null,
    request: CreateRequest,
  ): Promise<NodeView> {
    for (let attempt = 1; ; attempt++) {
      const address = nextChildAddress(
        parent?.address ?? null,
        await this.nodes.childAddresses(did, parent),
      );
      // A branch the server numbers has to be one a person could have named,
      // or the branch after it would have no number left to take.
      if (parent === null && !isRootAddress(address)) {
        throw new BadRequestException(
          "There is no number left after your highest branch. Number a lower one.",
        );
      }
      try {
        return entityView(
          await this.nodes.insert(newNode(did, address, parent, request)),
        );
      } catch (err) {
        const lost =
          attempt < ADDRESS_ATTEMPTS &&
          (await this.nodes.addressTaken(did, address));
        if (!lost) throw err;
      }
    }
  }
}

function taken(address: Address): BadRequestException {
  return new BadRequestException(
    `You already have a branch numbered ${address}. Pick another number.`,
  );
}

function newNode(
  did: string,
  address: Address,
  parent: Node | null,
  request: CreateRequest,
): Node {
  const id = createOwnedRecordId("node", did);
  const now = nowIso();
  return parseNode({
    id,
    created_by: did,
    address,
    depth: addressDepth(address),
    ...(parent ? { parent: ownedRefFrom(parent.id) } : {}),
    origin: parent ? parent.origin : ownedRefFrom(id),
    title: request.title,
    tags: request.tags,
    links: [],
    published: false,
    created_at: now,
    updated_at: now,
  });
}
