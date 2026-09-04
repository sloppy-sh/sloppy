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
import { alreadyDerived, citationsMoved, referencesOf } from "./references";

type CreateRequest = z.output<typeof CreateBlockRequestSchema>;
type UpdateRequest = z.output<typeof UpdateBlockRequestSchema>;

@Injectable()
export class BlockService {
  /**
   * One note's writes, one at a time: placing a block reads the stack before it
   * writes an `ord`, and deriving the note's references reads the whole stack
   * before it writes the row. Both would otherwise interleave with each other
   * and with themselves.
   */
  private readonly perNote = new SerialQueue();

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
    const written = await this.perNote.run(request.node, async () => {
      const ord = this.place(
        await this.stack(request.node),
        request.after ?? null,
      );
      const now = nowIso();
      return this.blocks.insert({
        id: createOwnedRecordId("block", did),
        created_by: did,
        node: request.node,
        ord,
        content: request.content,
        created_at: now,
        updated_at: now,
      });
    });
    if (citationsMoved(null, request.content)) {
      await this.derive(did, request.node);
    }
    return entityView(written);
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

    if (request.after === ref) {
      throw new BadRequestException("A block cannot follow itself.");
    }
    const written = await this.perNote.run(block.node, async () => {
      if (request.after !== undefined) {
        const stack = (await this.stack(block.node)).filter(
          (other) => other.ref !== ref,
        );
        changes.ord = this.place(stack, request.after ?? null);
      }
      return this.save(did, ref, changes);
    });
    // A section moved within the stack names the same notes in a new order.
    if (
      request.after !== undefined ||
      citationsMoved(block.content, written.content)
    ) {
      await this.derive(did, block.node);
    }
    return entityView(written);
  }

  async remove(did: string, ref: OwnedRef): Promise<void> {
    const block = await this.blocks.find(did, ref);
    await this.blocks.remove(did, ref);
    if (block && citationsMoved(block.content, null)) {
      await this.derive(did, block.node);
    }
  }

  /**
   * Brings the note's `references` back into step with what its stack now says,
   * which is what makes a `[[` draw a line and deleting those words take it
   * away. docs/ARCHITECTURE.md § "Data model".
   */
  private async derive(did: string, node: OwnedRef): Promise<void> {
    await this.perNote.run(node, async () => {
      const held = await this.nodes.find(did, node);
      if (!held) return;
      const derived = referencesOf(node, await this.blocks.listByNode(node));
      if (alreadyDerived(held.references, derived)) return;
      await this.nodes.setReferences(did, node, derived);
    });
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
