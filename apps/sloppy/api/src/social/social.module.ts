import { Module } from "@nestjs/common";
import { MediaModule } from "../media/media.module";
import { SyrModule } from "../syr/syr.module";
import {
  NoteConversationController,
  SocialController,
} from "./social.controller";
import { SocialService } from "./social.service";

/** What people say back, and who a reader hears it from. Every record here
 *  belongs to an identity store; Sloppy holds none of them. */
@Module({
  imports: [SyrModule, MediaModule],
  controllers: [SocialController, NoteConversationController],
  providers: [SocialService],
})
export class SocialModule {}
