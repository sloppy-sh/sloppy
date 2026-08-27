import { Module } from "@nestjs/common";
import { MediaModule } from "../media/media.module";
import { SyrModule } from "../syr/syr.module";
import { EmojiController } from "./emoji.controller";
import { EmojiService } from "./emoji.service";

/** Per-identity emoji catalogs, read and written on the identity's own store. */
@Module({
  imports: [SyrModule, MediaModule],
  controllers: [EmojiController],
  providers: [EmojiService],
})
export class EmojiModule {}
