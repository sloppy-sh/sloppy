import { Module } from "@nestjs/common";
import { SyrModule } from "../syr/syr.module";
import { IdentityKeysService } from "./identity-keys.service";
import { IdentityVouchService } from "./identity-vouch.service";

/** Who somebody is to this instance: which key speaks for them, and whether
 *  anybody stands behind them. A feature module that needs either of those
 *  imports this rather than reaching for a binding itself. */
@Module({
  imports: [SyrModule],
  providers: [IdentityKeysService, IdentityVouchService],
  exports: [IdentityKeysService, IdentityVouchService],
})
export class IdentityModule {}
