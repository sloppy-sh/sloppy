import {
  Inject,
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
 * applied — `defineCoreSchema` is idempotent and runs on every boot.
 * `docs/ARCHITECTURE.md` § "Data model" says why it must.
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

  constructor(
    private readonly config: AppConfigService,
    @Inject(Surreal) private readonly db: Surreal,
  ) {}

  /** The live handle. Repositories take this and hold nothing else. */
  get handle(): Surreal {
    return this.db;
  }

  async onModuleInit(): Promise<void> {
    const { url, username, password, namespace, database } =
      this.config.surreal;
    await this.db.connect(url, {
      // Handed over rather than spent through `signin()`: `signin()` opts the
      // session out of the driver's own renewal for the life of the connection,
      // and a root token lasts an hour. Without this the connection drops to
      // anonymous — every query failing until somebody restarts the process.
      authentication: { username, password },
    });
    // Not named to `connect` above, which would select them before it
    // authenticates, and an anonymous select cannot create what a first boot
    // against an empty store needs creating.
    await this.db.use({ namespace, database });
    await defineCoreSchema(this.db);
    this.logger.log(
      `Connected to SurrealDB at ${url} (${namespace}/${database})`,
    );
    this.db.subscribe("reconnecting", () =>
      this.logger.warn("Lost the SurrealDB connection; reconnecting"),
    );
    this.db.subscribe("connected", () =>
      this.logger.log("SurrealDB connection restored"),
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
