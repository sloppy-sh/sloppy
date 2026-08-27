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
  type Node,
  type NodeView,
  nowIso,
  type OwnedRef,
  ownedRefFrom,
  parseNode,
  type UpdateNodeRequestSchema,
} from "@sloppy/types";
import type { z } from "zod";
import { LabelService } from "../label/label.service";
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

  constructor(
    private readonly nodes: NodeRepository,
    private readonly labels: LabelService,
  ) {}

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

  async create(did: string, request: CreateRequest): Promise<NodeView> {
    await this.labels.assertUsable(did, request.labels);
    const parent = request.parent
      ? await this.nodes.find(did, request.parent)
      : null;
    if (request.parent && !parent) {
      throw new BadRequestException("The note this springs from is not here.");
    }
    return this.creations.run(`${did}|${parent?.address ?? ""}`, () =>
      this.write(did, parent, request),
    );
  }

  async update(
    did: string,
    ref: OwnedRef,
    request: UpdateRequest,
  ): Promise<NodeView> {
    if (request.labels) await this.labels.assertUsable(did, request.labels);
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
    labels: request.labels,
    links: [],
    published: false,
    created_at: now,
    updated_at: now,
  });
}
