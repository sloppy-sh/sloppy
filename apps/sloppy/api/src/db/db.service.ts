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

/** Applied to every connection this service opens. */
export type DefineSchema = (db: Surreal) => Promise<unknown>;

/**
 * The one connection to Sloppy's own store, and the one place a schema is
 * applied — the core tables and every module's own, on every open.
 * `docs/ARCHITECTURE.md` § "Data model" says why they must be idempotent.
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
  private readonly schemas: DefineSchema[] = [defineCoreSchema];
  private readonly waiting: Array<() => void> = [];
  private ready = false;
  private opening = false;
  private closing = false;
  private wake: (() => void) | undefined;

  constructor(
    private readonly config: AppConfigService,
    @Inject(Surreal) private readonly db: Surreal,
  ) {}

  /**
   * The live connection. Repositories take this and hold nothing else, and it
   * refuses rather than hand back one that is not ready: work put to a
   * connection the driver is still opening is neither sent nor failed, and a
   * store whose schema is not on it yet answers that its tables do not exist.
   */
  get handle(): Surreal {
    if (!this.ready || this.db.status !== "connected")
      throw new ConnectionUnavailableError();
    return this.db;
  }

  /**
   * Registered before the first open, and applied to every open after it: a
   * store rebuilt while this service was away comes back with nothing on it.
   */
  defineOnOpen(schema: DefineSchema): void {
    this.schemas.push(schema);
  }

  /** For a one-shot caller with nothing to do until the store answers. A
   *  request never waits on this — it is refused while the store is away. */
  whenOpen(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve) => {
      this.waiting.push(resolve);
    });
  }

  onModuleInit(): void {
    this.db.subscribe("disconnected", () => this.reopen());
    // Not awaited: the API listens whether or not the store is there. Awaited,
    // an outage at boot costs the product every route into it, sign-in included.
    void this.keepOpening();
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    this.wake?.();
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
    this.ready = false;
    this.logger.warn("Lost the SurrealDB connection");
    void this.keepOpening();
  }

  /**
   * Opening is this service's job, not the driver's — which is told at `connect`
   * not to try, because its loop gives up after a fixed budget and never looks
   * again.
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
          break;
        } catch (err) {
          this.logger.warn(`SurrealDB is not open yet: ${reason(err)}`);
          await this.sleep(delay);
          delay = Math.min(delay * 2, DbService.RETRY_DELAY_MAX_MS);
        }
      }
    } finally {
      this.opening = false;
    }
    // Resumed after the loop has let go of `opening`, or a caller that acts on
    // the connection and loses it finds the reopen guarded out.
    if (this.ready) for (const resume of this.waiting.splice(0)) resume();
  }

  private async open(): Promise<void> {
    const { url, username, password, namespace, database } =
      this.config.surreal;
    this.ready = false;
    await this.connectOrFail(url, { username, password });
    // Not named to `connect`, which would select them before it authenticates,
    // and an anonymous select cannot create what a first boot against an empty
    // store needs creating.
    await this.db.use({ namespace, database });
    for (const schema of this.schemas) await schema(this.db);
    this.ready = true;
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

  /** Ref'd deliberately: a process that exits while it is retrying exits
   *  reporting success, and nothing restarts that. Shutdown cuts it short. */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
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
