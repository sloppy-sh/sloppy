import { type DynamicModule, Module } from "@nestjs/common";
import { localIdpEnabled } from "../config/app-config.service";
import { BlobController } from "./blob.controller";
import { BlobStore } from "./blob-store";
import { ConsentController } from "./consent.controller";
import { IdentityController } from "./identity.controller";
import { IdpSessionGuard, PlatformTokenGuard } from "./idp.guards";
import { IdpService } from "./idp.service";
import { OwnerController } from "./owner.controller";
import { PlatformController } from "./platform.controller";
import { WellKnownController } from "./well-known.controller";

/**
 * The embedded identity provider — syr's wire contracts, served by this API, so
 * the app works with no network at all. docs/ARCHITECTURE.md § "Local-only
 * mode", § "Monorepo layout".
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
        ConsentController,
        PlatformController,
        OwnerController,
        BlobController,
      ],
      providers: [IdpService, IdpSessionGuard, PlatformTokenGuard, BlobStore],
      exports: [IdpService],
    };
  }
}
