import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthGuard } from "./auth.guard";

/**
 * Identity, through syr's Platform Delegation — docs/ARCHITECTURE.md § "Auth:
 * Platform Delegation v0.1". Only the guard stack exists so far; the consent
 * round trip, the session store and signing land with it.
 *
 * The guard list is ordered: a later `APP_GUARD` runs after an earlier one, so
 * anything that needs a viewer goes below `AuthGuard`.
 */
@Module({
  providers: [AuthGuard, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthGuard],
})
export class AuthModule {}
