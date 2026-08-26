import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { defineCoreSchema } from "@sloppy/data";
import { Surreal } from "surrealdb";
import { AppConfigService } from "../config/app-config.service";

/**
 * The one connection to Sloppy's own store, and the one place the schema is
 * applied. `defineCoreSchema` is idempotent and runs on every boot because
 * production SurrealDB serves only `DEFINE`d tables while the dev stack does
 * not enforce that — a table that was never defined passes locally and fails
 * where it matters.
 */
@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  /**
   * Measured against the 3.1.3 container: a query issued after the server goes
   * away neither resolves nor rejects — the client queues it for a reconnection
   * that may never come. So the liveness probe is bounded, or it hangs in
   * exactly the condition it exists to report.
   */
  private static readonly PROBE_TIMEOUT_MS = 2000;

  private readonly logger = new Logger(DbService.name);
  private readonly db = new Surreal();

  constructor(private readonly config: AppConfigService) {}

  /** The live handle. Repositories take this and hold nothing else. */
  get handle(): Surreal {
    return this.db;
  }

  async onModuleInit(): Promise<void> {
    const { url, username, password, namespace, database } =
      this.config.surreal;
    await this.db.connect(url);
    await this.db.signin({ username, password });
    await this.db.use({ namespace, database });
    await defineCoreSchema(this.db);
    this.logger.log(
      `Connected to SurrealDB at ${url} (${namespace}/${database})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.db.close();
  }

  /** A round trip, not a cached flag: the point is to catch a connection that
   *  has gone away since boot. */
  async reachable(): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.db.query("RETURN true"),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error("liveness probe timed out")),
            DbService.PROBE_TIMEOUT_MS,
          );
        }),
      ]);
      return true;
    } catch (err) {
      this.logger.warn(
        `SurrealDB unreachable: ${err instanceof Error ? err.message : err}`,
      );
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
