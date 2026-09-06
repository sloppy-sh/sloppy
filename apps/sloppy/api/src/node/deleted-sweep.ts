// Ending the window on branches somebody deleted and never came back for.
// docs/ARCHITECTURE.md § "Data model".

import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { DbService } from "../db/db.service";
import { NodeService } from "./node.service";

/** How often the window is swept. It is open for `DELETED_KEPT_FOR_DAYS`, so a
 *  day's grain is a rounding error on it. */
const SWEEP_EVERY_MS = 24 * 60 * 60 * 1000;

/**
 * A person who deletes a branch and comes back sweeps their own window: the
 * routes that delete, list and put back run it first. This is the one that
 * reaches the person who never comes back.
 */
@Injectable()
export class DeletedSweep
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(DeletedSweep.name);
  private repeating: NodeJS.Timeout | undefined;

  constructor(
    private readonly db: DbService,
    private readonly nodes: NodeService,
  ) {}

  onApplicationBootstrap(): void {
    void this.run();
    this.repeating = setInterval(() => void this.run(), SWEEP_EVERY_MS);
    // Nobody waits on the next sweep, so it must not hold the process open.
    this.repeating.unref();
  }

  onApplicationShutdown(): void {
    if (this.repeating) clearInterval(this.repeating);
  }

  /** Resolves with how many people this sweep had anything to do for. */
  async run(): Promise<number> {
    try {
      await this.db.whenOpen();
      return await this.nodes.sweepEveryone();
    } catch (err) {
      const said = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Could not end the window on deleted branches: ${said}`);
      return 0;
    }
  }
}
