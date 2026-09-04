// A node's interior: the block stack, and where a block lands in it.

import {
  BadRequestException,
  Injectable,
  Logger,
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
import {
  alreadyDerived,
  citationsMoved,
  movingReorders,
  referencesOf,
} from "./references";

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
  private readonly logger = new Logger(BlockService.name);

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
    const node = await this.blocks.nodeOf(did, ref);
    if (!node) throw new NotFoundException("That block is not here.");
    if (request.after === ref) {
      throw new BadRequestException("A block cannot follow itself.");
    }

    const { written, moved } = await this.perNote.run(node, async () => {
      // Read inside the queue: what this write replaced is what says whether the
      // note's citations moved, and a writer ahead in the queue has already
      // replaced anything read before it.
      const before = await this.blocks.find(did, ref);
      if (!before) throw new NotFoundException("That block is not here.");

      const changes: BlockPatch = {};
      if (request.content !== undefined) changes.content = request.content;
      if (request.after !== undefined) {
        const stack = (await this.stack(node)).filter(
          (other) => other.ref !== ref,
        );
        changes.ord = this.place(stack, request.after ?? null);
      }
      const saved = await this.save(did, ref, changes);
      return {
        written: saved,
        // A section moved within the stack names the same notes in a new order
        // — unless it names none, which no position can reorder.
        moved:
          citationsMoved(before.content, saved.content) ||
          (request.after !== undefined && movingReorders(saved.content)),
      };
    });
    if (moved) await this.derive(did, node);
    return entityView(written);
  }

  async remove(did: string, ref: OwnedRef): Promise<void> {
    const node = await this.blocks.nodeOf(did, ref);
    if (node === null) return;
    const moved = await this.perNote.run(node, async () => {
      const held = await this.blocks.find(did, ref);
      await this.blocks.remove(did, ref);
      return held !== null && citationsMoved(held.content, null);
    });
    if (moved) await this.derive(did, node);
  }

  /**
   * Brings the note's `references` back into step with what its stack now says,
   * which is what makes a `[[` draw a line and deleting those words take it
   * away. docs/ARCHITECTURE.md § "Data model".
   *
   * The section is stored by the time this runs, so a failure is logged rather
   * than raised: a write answered with an error is one the editor stores a
   * second time.
   */
  private async derive(did: string, node: OwnedRef): Promise<void> {
    try {
      await this.perNote.run(node, async () => {
        const held = await this.nodes.find(did, node);
        if (!held) return;
        const derived = referencesOf(node, await this.blocks.listByNode(node));
        if (alreadyDerived(held.references, derived)) return;
        await this.nodes.setReferences(did, node, derived);
      });
    } catch (err) {
      const said = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Could not derive what a note cites: ${said}`);
    }
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
