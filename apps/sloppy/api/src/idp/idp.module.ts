import { type DynamicModule, Module } from "@nestjs/common";
import { localIdpEnabled } from "../config/app-config.service";
import { IdentityController } from "./identity.controller";
import { IdpSessionGuard, PlatformTokenGuard } from "./idp.guards";
import { IdpService } from "./idp.service";
import { PlatformController } from "./platform.controller";
import { WellKnownController } from "./well-known.controller";

/**
 * The embedded identity provider — syr's wire contracts, served by this API, so
 * the app works with no network at all. docs/ARCHITECTURE.md § "Local-only
 * mode", § "Monorepo layout".
 *
 * The gate registers nothing rather than answering differently: with the
 * provider off there is no route, so this instance is not a syr instance and
 * says so the only way that cannot be misread — `/.well-known/syr` is simply
 * not there. Reading the flag here, before Nest has a `ConfigService`, is why
 * the module is dynamic.
 */
@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: Nest resolves a dynamic module through a static factory on the module class; there is no free-function form of it.
export class IdpModule {
  static forRoot(): DynamicModule {
    if (!localIdpEnabled()) return { module: IdpModule };
    return {
      module: IdpModule,
      controllers: [
        WellKnownController,
        IdentityController,
        PlatformController,
      ],
      providers: [IdpService, IdpSessionGuard, PlatformTokenGuard],
      exports: [IdpService],
    };
  }
}
