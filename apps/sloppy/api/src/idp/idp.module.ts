import { type DynamicModule, Module } from "@nestjs/common";

/**
 * The embedded identity provider — syr's wire contracts, served by this API, so
 * the app works with no network at all (docs/ARCHITECTURE.md § "Local-only
 * mode"). Gated on `SLOPPY_LOCAL_IDP`, and off by default.
 *
 * Dynamic where the other feature modules are plain, and that is the whole
 * point of it: the gate is on whether this module registers anything at all,
 * and `app.module.ts` is closed to the tracks. Deciding here rather than in the
 * import list is what keeps both true at once — which is also why `env.ts` runs
 * before any module is required.
 */
@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: Nest resolves a dynamic module through a static factory on the module class; there is no free-function form of it.
export class IdpModule {
  static forRoot(): DynamicModule {
    return { module: IdpModule };
  }
}
