import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Every environment variable the API reads, named once. A getter here is what
 * stops two modules from spelling the same key two ways, and what makes the
 * defaults a fresh clone runs on visible in one place.
 *
 * The SurrealDB defaults match `docker-compose.yml`, so `docker compose up -d`
 * followed by `pnpm dev:api` needs no `.env` at all.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService) {}

  get isProduction(): boolean {
    return this.config.get("NODE_ENV", "development") === "production";
  }

  get port(): number {
    return Number(this.config.get("SLOPPY_API_PORT", 8020));
  }

  /** Where this instance answers from, as a peer resolving it would write it. */
  get publicUrl(): string {
    return this.config.get("PUBLIC_URL", `http://localhost:${this.port}`);
  }

  /**
   * What is in front of this instance, so `req.ip` is the reader's address
   * rather than the last hop's. A count is how many proxies forward to us — the
   * safe form, because only the hop that many back is read and a forged
   * `x-forwarded-for` cannot reach it. A comma-separated list of addresses or
   * subnets works too; `false` is an instance nothing forwards to.
   *
   * Unset in development this trusts the private network, because the web
   * shell's dev server stands in for the shared origin. Unset in production it
   * trusts nothing: an operator who puts a proxy in front says so.
   */
  get trustedProxies(): number | string | false {
    const configured = (
      this.config.get<string>("SLOPPY_TRUSTED_PROXIES") ?? ""
    ).trim();
    if (!configured) {
      return this.isProduction ? false : "loopback, linklocal, uniquelocal";
    }
    const hops = Number(configured);
    return Number.isInteger(hops) && hops >= 0 ? hops : configured;
  }

  /** Origins allowed to make a credentialed request, beyond the shells' own. */
  get allowedOrigins(): string[] {
    return (this.config.get<string>("SLOPPY_ALLOWED_ORIGINS") ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
  }

  get surreal(): {
    url: string;
    username: string;
    password: string;
    namespace: string;
    database: string;
  } {
    return {
      url: this.config.get("SLOPPY_SURREALDB_URL", "ws://127.0.0.1:8010/rpc"),
      username: this.config.get("SURREALDB_USER", "root"),
      password: this.config.get("SURREALDB_PASS", "sloppy-dev-password"),
      namespace: this.config.get("SURREALDB_NAMESPACE", "sloppy"),
      database: this.config.get("SURREALDB_DATABASE", "sloppy"),
    };
  }

  /** Where the embedded provider keeps the blobs it is given. The defaults
   *  match `docker-compose.yml`, so a fresh clone needs no `.env`. */
  get objectStore(): {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
  } {
    return {
      endpoint: this.config.get("S3_ENDPOINT", "http://localhost:9010"),
      region: this.config.get("S3_REGION", "us-east-1"),
      bucket: this.config.get("S3_BUCKET", "sloppy"),
      accessKeyId: this.config.get("S3_ACCESS_KEY_ID", "sloppy-access-key"),
      secretAccessKey: this.config.get(
        "S3_SECRET_ACCESS_KEY",
        "sloppy-secret-key",
      ),
    };
  }

  get localIdpEnabled(): boolean {
    return localIdpEnabled();
  }
}

/**
 * Whether this build serves identity itself instead of delegating to a syr
 * instance. Read straight from `process.env` because `IdpModule` decides what
 * to register before Nest has a `ConfigService` to inject; `env.ts` is what
 * makes the workspace `.env` visible by then.
 */
export function localIdpEnabled(): boolean {
  return ["1", "true"].includes(
    (process.env.SLOPPY_LOCAL_IDP ?? "").trim().toLowerCase(),
  );
}
