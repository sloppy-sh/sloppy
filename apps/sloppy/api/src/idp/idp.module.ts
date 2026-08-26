import { type DynamicModule, Module } from "@nestjs/common";

/**
 * The embedded identity provider — syr's wire contracts, served by this API, so
 * the app works with no network at all. docs/ARCHITECTURE.md § "Local-only
 * mode"; it is a dynamic module because the gate has to live inside it, which
 * is also why `env.ts` runs before any module is required.
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
