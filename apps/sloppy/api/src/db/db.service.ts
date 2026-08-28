import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { defineCoreSchema } from "@sloppy/data";
import { ConnectionUnavailableError, Surreal } from "surrealdb";
import { AppConfigService } from "../config/app-config.service";

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    // Unreffed: a retry being waited out must not hold the process open.
    setTimeout(resolve, ms).unref();
  });
}

/**
 * The one connection to Sloppy's own store, and the one place the schema is
 * applied — `defineCoreSchema` is idempotent and runs on every open.
 * `docs/ARCHITECTURE.md` § "Data model" says why it must.
 */
@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  /**
   * A socket does not fail the moment the server behind it does, and a call
   * written into one that will never answer is never settled. So the liveness
   * probe is bounded, or it hangs in exactly the condition it exists to report.
   */
  private static readonly PROBE_TIMEOUT_MS = 2000;

  /** A backstop under `connectOrFail`, for a server that takes a socket and
   *  then says nothing: an attempt that neither succeeds nor fails is one this
   *  service can never retry. */
  private static readonly OPEN_TIMEOUT_MS = 15_000;

  private static readonly RETRY_DELAY_MS = 500;
  private static readonly RETRY_DELAY_MAX_MS = 5000;

  private readonly logger = new Logger(DbService.name);
  private opening = false;
  private closing = false;

  constructor(
    private readonly config: AppConfigService,
    @Inject(Surreal) private readonly db: Surreal,
  ) {}

  /**
   * The live connection. Repositories take this and hold nothing else, and it
   * refuses rather than hand back one that is not open: work put to a connection
   * the driver is still opening is neither sent nor failed, so the request
   * behind it is never answered.
   */
  get handle(): Surreal {
    if (this.db.status !== "connected") throw new ConnectionUnavailableError();
    return this.db;
  }

  async onModuleInit(): Promise<void> {
    this.db.subscribe("disconnected", () => this.reopen());
    await this.keepOpening();
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    await this.db.close();
  }

  async reachable(): Promise<boolean> {
    try {
      await this.bounded(
        this.handle.query("RETURN true"),
        DbService.PROBE_TIMEOUT_MS,
        "liveness probe",
      );
      return true;
    } catch (err) {
      this.logger.warn(`SurrealDB unreachable: ${reason(err)}`);
      return false;
    }
  }

  private reopen(): void {
    if (this.closing || this.opening) return;
    this.logger.warn("Lost the SurrealDB connection");
    void this.keepOpening();
  }

  /**
   * Opening is this service's job, not the driver's — which is told at `connect`
   * not to try. Its loop gives up after a fixed budget and never looks again,
   * and what it restores is a session, so a store rebuilt while it was away
   * comes back with no schema on it. Neither state recovers short of a restart.
   */
  private async keepOpening(): Promise<void> {
    if (this.opening) return;
    this.opening = true;
    try {
      let delay = DbService.RETRY_DELAY_MS;
      while (!this.closing) {
        try {
          await this.bounded(
            this.open(),
            DbService.OPEN_TIMEOUT_MS,
            "opening the SurrealDB connection",
          );
          return;
        } catch (err) {
          this.logger.warn(`SurrealDB is not open yet: ${reason(err)}`);
          await sleep(delay);
          delay = Math.min(delay * 2, DbService.RETRY_DELAY_MAX_MS);
        }
      }
    } finally {
      this.opening = false;
    }
  }

  private async open(): Promise<void> {
    const { url, username, password, namespace, database } =
      this.config.surreal;
    await this.connectOrFail(url, { username, password });
    // Not named to `connect`, which would select them before it authenticates,
    // and an anonymous select cannot create what a first boot against an empty
    // store needs creating.
    await this.db.use({ namespace, database });
    await defineCoreSchema(this.db);
    this.logger.log(
      `Connected to SurrealDB at ${url} (${namespace}/${database})`,
    );
  }

  private async connectOrFail(
    url: string,
    authentication: { username: string; password: string },
  ): Promise<void> {
    // Whatever is left of the last connection goes first, so a `disconnected`
    // from here on belongs to this attempt — against a server that is not
    // there, `connect` publishes one and then never settles.
    await this.db.close();
    let heard!: () => void;
    const gaveUp = new Promise<never>((_resolve, reject) => {
      heard = this.db.subscribe("disconnected", () =>
        reject(new Error("the server did not take a connection")),
      );
    });
    try {
      await Promise.race([
        this.db.connect(url, {
          // Handed over rather than spent through `signin()`: `signin()` opts
          // the session out of the driver's own renewal for the life of the
          // connection, and a root token lasts an hour. Without this the
          // connection drops to anonymous — every query failing until somebody
          // restarts the process.
          authentication,
          // Off because work put to a connection the driver is nursing back is
          // never settled: every route hangs for as long as it tries. Off, the
          // driver fails that work, and `keepOpening` does the recovering.
          reconnect: false,
        }),
        gaveUp,
      ]);
    } finally {
      heard();
    }
  }

  private async bounded<T>(
    work: PromiseLike<T>,
    ms: number,
    what: string,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
