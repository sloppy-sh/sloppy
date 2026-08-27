import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { DbModule } from "../db/db.module";
import { SyrModule } from "../syr/syr.module";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import { SessionStore } from "./session.store";

/**
 * Identity, through syr's Platform Delegation — docs/ARCHITECTURE.md § "Auth:
 * Platform Delegation v0.1".
 *
 * `DbModule` is global and needs no import to be injectable; it is named anyway
 * because that edge is what orders the two module inits, and `SessionStore`
 * defines its table against a connection `DbService` has to have opened first.
 *
 * The guard list is ordered: a later `APP_GUARD` runs after an earlier one, so
 * anything that needs a viewer goes below `AuthGuard`.
 */
@Module({
  imports: [DbModule, SyrModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionStore,
    AuthGuard,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthGuard, AuthService, SyrModule],
})
export class AuthModule {}
