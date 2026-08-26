import { randomBytes } from "node:crypto";
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  defineIdentitySchema,
  deriveIdpSecrets,
  type IdpContext,
  type IdpSecrets,
  normalizeBaseUrl,
} from "@sloppy/idp";
import { AppConfigService } from "../config/app-config.service";
import { DbService } from "../db/db.service";

/**
 * What the embedded provider needs that a request does not carry: the store,
 * the secret its keys and tokens hang off, and the URL a peer reaches this
 * instance at.
 *
 * The identity tables are defined here rather than in `@sloppy/data`'s core
 * schema, because an instance that delegates identity to somebody else should
 * never grow a place to put one. This service only exists when the provider is
 * registered.
 */
@Injectable()
export class IdpService implements OnApplicationBootstrap {
  private readonly logger = new Logger(IdpService.name);
  private readonly secrets: IdpSecrets;

  constructor(
    private readonly config: AppConfigService,
    private readonly env: ConfigService,
    private readonly db: DbService,
  ) {
    this.secrets = deriveIdpSecrets(this.rootSecret());
  }

  get context(): IdpContext {
    return {
      db: this.db.handle,
      secrets: this.secrets,
      publicUrl: normalizeBaseUrl(this.config.publicUrl),
    };
  }

  /** After every module has initialised, so the connection this runs on is the
   *  one `DbService` opened rather than one that happens to be ready. */
  async onApplicationBootstrap(): Promise<void> {
    await defineIdentitySchema(this.db.handle);
  }

  private rootSecret(): string {
    const configured = this.env.get<string>("SLOPPY_IDP_SECRET");
    if (configured) return configured;
    if (this.config.isProduction) {
      throw new Error(
        "SLOPPY_IDP_SECRET must be set to serve identity from this instance",
      );
    }
    // A generated one is enough to develop against and useless afterwards: the
    // keys sealed under it cannot be opened by the next process, so an account
    // made now cannot sign after a restart.
    this.logger.warn(
      "No SLOPPY_IDP_SECRET set. Accounts created now stop working when this process does.",
    );
    return randomBytes(32).toString("hex");
  }
}
