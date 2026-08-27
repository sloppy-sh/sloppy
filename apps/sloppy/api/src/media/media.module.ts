import { Module } from "@nestjs/common";
import { SyrModule } from "../syr/syr.module";
import { ProxyController } from "./proxy.controller";
import { MediaController } from "./media.controller";
import { MediaService } from "./media.service";

/**
 * Media: asking the person's identity store to hold a blob, and fetching
 * anybody's back without telling them who is looking.
 */
@Module({
  imports: [SyrModule],
  controllers: [MediaController, ProxyController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
