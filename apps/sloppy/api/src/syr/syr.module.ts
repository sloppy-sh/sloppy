import { Module } from "@nestjs/common";
import { SyrService } from "./syr.service";

/**
 * The syr side of the wire — the manifest, the consent round trip, and signing
 * on somebody's behalf. A feature module that needs a signature imports this
 * rather than reaching for `fetch`.
 */
@Module({
  providers: [SyrService],
  exports: [SyrService],
})
export class SyrModule {}
