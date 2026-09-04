// Deriving `references` for notes whose writing was already there.
// docs/ARCHITECTURE.md § "Data model".

import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { DbService } from "../db/db.service";
import { NodeRepository } from "../node/node.repository";
import { BlockRepository } from "./block.repository";
import { referencesOf } from "./references";

/** Notes one scan names — refs only, so this bounds the scan and not the
 *  memory. */
const PER_PASS = 2000;

/** Notes whose stacks are read at once. A stack is documents, so this is what
 *  bounds the sweep's memory. */
const STACKS_AT_ONCE = 200;

/**
 * A note's `references` are derived when its writing is written, so a line
 * somebody typed before the derivation shipped stays off the canvas until they
 * edit that note again. This derives what is already stored.
 *
 * `citedNotes` over a stored document cannot be SurrealQL, which is why this is
 * not beside `schema.ts`'s migrations.
 *
 * **What it writes is its own guard.** A note it reaches gains `references`,
 * `[]` included, so no later pass names it again — nothing else marks it done,
 * and so nothing else has to be kept in step.
 */
@Injectable()
export class ReferenceBackfill implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReferenceBackfill.name);

  constructor(
    private readonly db: DbService,
    private readonly nodes: NodeRepository,
    private readonly blocks: BlockRepository,
  ) {}

  /** Not awaited: the API serves while this runs, and a store that never opens
   *  must not hold the process at boot. */
  onApplicationBootstrap(): void {
    void this.run().catch((err: unknown) => {
      const said = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Could not derive what older notes cite: ${said}`);
    });
  }

  /** Resolves with how many notes this run derived. */
  async run(): Promise<number> {
    await this.db.whenOpen();
    let derived = 0;
    for (;;) {
      const pending = await this.nodes.withoutReferences(PER_PASS);
      if (pending.length === 0) break;
      for (let at = 0; at < pending.length; at += STACKS_AT_ONCE) {
        const batch = pending.slice(at, at + STACKS_AT_ONCE);
        const stacks = await this.blocks.storedByNodes(batch);
        await this.nodes.fillReferences(
          new Map(
            batch.map((node) => [
              node,
              referencesOf(node, stacks.get(node) ?? []),
            ]),
          ),
        );
        derived += batch.length;
      }
    }
    if (derived > 0) {
      this.logger.log(`Derived what ${derived} older notes cite`);
    }
    return derived;
  }
}
