import { Module } from "@nestjs/common";
import { SyrService } from "./syr.service";
import { VouchService } from "./vouch.service";

/**
 * The syr side of the wire — the manifest, the consent round trip, signing on
 * somebody's behalf, and whether anybody stands behind an identity. A feature
 * module that needs one of those imports this rather than reaching for `fetch`.
 */
@Module({
  providers: [SyrService, VouchService],
  exports: [SyrService, VouchService],
})
export class SyrModule {}
