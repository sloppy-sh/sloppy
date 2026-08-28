// A node's interior: the block stack, and where a block lands in it.

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  type Block,
  type BlockView,
  type CreateBlockRequestSchema,
  createOwnedRecordId,
  entityView,
  nowIso,
  type OwnedRef,
  ownedRefFrom,
  type UpdateBlockRequestSchema,
} from "@sloppy/types";
import type { z } from "zod";
import { NodeRepository } from "../node/node.repository";
import { SerialQueue } from "../node/serial-queue";
import { BlockRepository, type BlockPatch } from "./block.repository";
import { ordAfter, type Placed, UnknownNeighbourError } from "./placement";

type CreateRequest = z.output<typeof CreateBlockRequestSchema>;
type UpdateRequest = z.output<typeof UpdateBlockRequestSchema>;

@Injectable()
export class BlockService {
  private readonly placements = new SerialQueue();

  constructor(
    private readonly blocks: BlockRepository,
    private readonly nodes: NodeRepository,
  ) {}

  async list(did: string, node: OwnedRef): Promise<BlockView[]> {
    if (!(await this.nodes.find(did, node))) {
      throw new NotFoundException("That note is not here.");
    }
    return (await this.blocks.listByNode(node)).map(entityView);
  }

  async create(did: string, request: CreateRequest): Promise<BlockView> {
    if (!(await this.nodes.find(did, request.node))) {
      throw new BadRequestException("That note is not here.");
    }
    return this.placements.run(request.node, async () => {
      const ord = this.place(
        await this.stack(request.node),
        request.after ?? null,
      );
      const now = nowIso();
      return entityView(
        await this.blocks.insert({
          id: createOwnedRecordId("block", did),
          created_by: did,
          node: request.node,
          ord,
          content: request.content,
          created_at: now,
          updated_at: now,
        }),
      );
    });
  }

  async update(
    did: string,
    ref: OwnedRef,
    request: UpdateRequest,
  ): Promise<BlockView> {
    const block = await this.blocks.find(did, ref);
    if (!block) throw new NotFoundException("That block is not here.");

    const changes: BlockPatch = {};
    if (request.content !== undefined) changes.content = request.content;

    if (request.after === undefined) {
      return entityView(await this.save(did, ref, changes));
    }
    if (request.after === ref) {
      throw new BadRequestException("A block cannot follow itself.");
    }
    return this.placements.run(block.node, async () => {
      const stack = (await this.stack(block.node)).filter(
        (other) => other.ref !== ref,
      );
      changes.ord = this.place(stack, request.after ?? null);
      return entityView(await this.save(did, ref, changes));
    });
  }

  async remove(did: string, ref: OwnedRef): Promise<void> {
    await this.blocks.remove(did, ref);
  }

  private async stack(node: OwnedRef): Promise<Placed[]> {
    return (await this.blocks.listByNode(node)).map((block) => ({
      ref: ownedRefFrom(block.id),
      ord: block.ord,
    }));
  }

  private place(stack: readonly Placed[], after: OwnedRef | null): string {
    try {
      return ordAfter(stack, after);
    } catch (err) {
      if (err instanceof UnknownNeighbourError) {
        throw new BadRequestException(
          "The block this one was going after is no longer in this note.",
        );
      }
      throw err;
    }
  }

  private async save(
    did: string,
    ref: OwnedRef,
    changes: BlockPatch,
  ): Promise<Block> {
    const saved = await this.blocks.patch(did, ref, changes);
    if (!saved) throw new NotFoundException("That block is not here.");
    return saved;
  }
}
