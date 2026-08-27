import { Module } from "@nestjs/common";
import { SyrModule } from "../syr/syr.module";
import { AssetLinks } from "./asset-link";
import { MediaController } from "./media.controller";
import { MediaService } from "./media.service";
import { ProxyController } from "./proxy.controller";

/**
 * Media: asking the person's identity store to hold a blob, minting the address
 * a picture is rendered from, and fetching one back without telling the machine
 * that holds it who is looking.
 */
@Module({
  imports: [SyrModule],
  controllers: [MediaController, ProxyController],
  providers: [MediaService, AssetLinks],
  exports: [MediaService, AssetLinks],
})
export class MediaModule {}
