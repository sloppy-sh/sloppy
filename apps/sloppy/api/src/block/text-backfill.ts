// Deriving the words of sections that were written before anything read them.
// docs/ARCHITECTURE.md § "Data model".

import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { DbService } from "../db/db.service";
import { BlockRepository } from "./block.repository";

/** Sections one pass reads. A pass carries their documents, so this is what
 *  bounds the backfill's memory. */
const PER_PASS = 200;

/**
 * A section's words are derived when the section is written, so writing kept
 * before there was anything to derive them into is writing a search cannot
 * reach. This derives what is already stored.
 *
 * **What it writes is its own guard.** A section it reaches gains `text`, the
 * empty string included, so no later pass reads it again.
 *
 * A copy the reader holds of somebody else's note gains its words when the
 * region is next refreshed, which rewrites the sections whole.
 */
@Injectable()
export class TextBackfill implements OnApplicationBootstrap {
  private readonly logger = new Logger(TextBackfill.name);

  constructor(
    private readonly db: DbService,
    private readonly blocks: BlockRepository,
  ) {}

  /** Not awaited: the API serves while this runs, and a store that never opens
   *  must not hold the process at boot. */
  onApplicationBootstrap(): void {
    void this.run().catch((err: unknown) => {
      const said = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Could not derive the words in older sections: ${said}`);
    });
  }

  /** Resolves with how many sections this run derived. */
  async run(): Promise<number> {
    await this.db.whenOpen();
    let derived = 0;
    for (;;) {
      const pending = await this.blocks.withoutText(PER_PASS);
      if (pending.length === 0) break;
      await this.blocks.fillText(pending);
      derived += pending.length;
    }
    if (derived > 0) {
      this.logger.log(`Derived the words in ${derived} older sections`);
    }
    return derived;
  }
}
