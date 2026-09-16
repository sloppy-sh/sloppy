// A node's interior: the block stack, and where a block lands in it.

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  type Block,
  type BlockView,
  blockView,
  type CreateBlockRequestSchema,
  createOwnedRecordId,
  nowIso,
  type OwnedRef,
  ownedRefFrom,
  type UpdateBlockRequestSchema,
} from "@sloppy/types";
import type { z } from "zod";
import { gatedElsewhere, writable } from "../node/gate";
import { NodeRepository } from "../node/node.repository";
import { SerialQueue } from "../node/serial-queue";
import { BlockRepository, type BlockPatch } from "./block.repository";
import { ordAfter, type Placed, UnknownNeighbourError } from "./placement";
import {
  alreadyDerived,
  citationsMoved,
  namesNotes,
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
    return (await this.blocks.listByNode(node)).map(blockView);
  }

  async create(did: string, request: CreateRequest): Promise<BlockView> {
    const note = await this.nodes.find(did, request.node);
    if (!note) throw new BadRequestException("That note is not here.");
    if (!writable(note, did)) throw gatedElsewhere();
    await this.nodes.joinAuthors(did, note);
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
    return blockView(written);
  }

  async update(
    did: string,
    ref: OwnedRef,
    request: UpdateRequest,
  ): Promise<BlockView> {
    const from = await this.blocks.nodeOf(did, ref);
    if (!from) throw new NotFoundException("That block is not here.");
    // A deleted note keeps its sections so they come back with it, and a write
    // that landed in one would be neither read nor counted in what the note
    // cites.
    const held = await this.nodes.find(did, from);
    if (!held) throw new NotFoundException("That note is not here.");
    if (!writable(held, did)) throw gatedElsewhere();
    await this.nodes.joinAuthors(did, held);
    const into = request.node ?? from;
    const carried = into !== from;
    if (carried) {
      const landing = await this.nodes.find(did, into);
      if (!landing) throw new BadRequestException("That note is not here.");
      if (!writable(landing, did)) throw gatedElsewhere();
      await this.nodes.joinAuthors(did, landing);
    }
    if (request.after === ref) {
      throw new BadRequestException("A block cannot follow itself.");
    }

    const { written, derives } = await this.inNotes([from, into], async () => {
      // Read inside the queue: what this write replaced is what says whether
      // the note's citations moved and whether the section is still the one the
      // writer read, and a writer ahead in the queue has already replaced
      // anything read before it.
      const before = await this.blocks.find(did, ref);
      if (!before) throw new NotFoundException("That block is not here.");
      // A reorder is placed against the stack the section was read in; a carry
      // names the stack it goes into, and a write that places nothing reads
      // neither.
      const reordering = !carried && request.after !== undefined;
      if (reordering && before.node !== from) {
        throw new ConflictException(
          "This section is in another note now. Open that note to see where it sits.",
        );
      }
      if (
        request.expects !== undefined &&
        request.expects !== before.updated_at
      ) {
        throw new ConflictException(
          "This section was written somewhere else. Open the note again to see what it says now.",
        );
      }

      const changes: BlockPatch = {};
      if (request.content !== undefined) changes.content = request.content;
      // Which note holds it and where it sits there are one write, so a carried
      // section is never in both stacks and never in neither.
      if (carried) changes.node = into;
      if (carried || request.after !== undefined) {
        const stack = (await this.stack(into)).filter(
          (other) => other.ref !== ref,
        );
        changes.ord = this.place(stack, request.after ?? null);
      }
      const saved = await this.save(did, ref, changes);
      return {
        written: saved,
        derives: this.rederives(before, saved, request),
      };
    });
    for (const note of derives) await this.derive(did, note);
    return blockView(written);
  }

  async remove(did: string, ref: OwnedRef): Promise<void> {
    const node = await this.blocks.nodeOf(did, ref);
    if (node === null) return;
    const inside = await this.nodes.find(did, node);
    if (inside && !writable(inside, did)) throw gatedElsewhere();
    if (inside) await this.nodes.joinAuthors(did, inside);
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
        const derived = referencesOf(
          node,
          await this.blocks.storedByNode(node),
        );
        if (alreadyDerived(held.references, derived)) return;
        await this.nodes.setReferences(did, node, derived);
      });
    } catch (err) {
      const said = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Could not derive what a note cites: ${said}`);
    }
  }

  /**
   * The notes whose `references` this write can have moved: the note the
   * section is in now, and the one it was carried out of.
   */
  private rederives(
    before: Block,
    saved: Block,
    request: UpdateRequest,
  ): OwnedRef[] {
    if (saved.node !== before.node) {
      return namesNotes(before.content) || namesNotes(saved.content)
        ? [before.node, saved.node]
        : [];
    }
    // A section moved within the stack names the same notes in a new order —
    // unless it names none, which no position can reorder.
    const moved =
      citationsMoved(before.content, saved.content) ||
      (request.after !== undefined && namesNotes(saved.content));
    return moved ? [saved.node] : [];
  }

  /**
   * Holds every note the write touches, always in the same order, so a section
   * carried one way and another carried back cannot each be waiting on the
   * stack the other holds.
   */
  private inNotes<T>(
    notes: readonly OwnedRef[],
    task: () => Promise<T>,
  ): Promise<T> {
    const [first, ...rest] = [...new Set(notes)].sort();
    if (first === undefined) return task();
    return this.perNote.run(first, () => this.inNotes(rest, task));
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
          "The block this one was going after is not in the note it is going into.",
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
