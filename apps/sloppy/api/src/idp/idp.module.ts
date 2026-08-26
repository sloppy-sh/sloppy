import { type DynamicModule, Module } from "@nestjs/common";

/**
 * The embedded identity provider — syr's wire contracts, served by this API, so
 * the app works with no network at all. The gate on what it registers lives in
 * this module, hence the dynamic form. docs/ARCHITECTURE.md § "Local-only mode",
 * § "Monorepo layout".
 *
 * TODO(M1 idp track): read `localIdpEnabled()` here and register behind it.
 * Nothing is gated yet, because there is nothing yet to register.
 */
@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: Nest resolves a dynamic module through a static factory on the module class; there is no free-function form of it.
export class IdpModule {
  static forRoot(): DynamicModule {
    return { module: IdpModule };
  }
}
