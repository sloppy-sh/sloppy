import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module";
import { MediaModule } from "../media/media.module";
import { NodeRepositoryModule } from "../node/node-repository.module";
import { SyrModule } from "../syr/syr.module";
import {
  NoteConversationController,
  SocialController,
} from "./social.controller";
import { PointerRepository } from "./pointer.repository";
import { RefusalRepository } from "./refusal.repository";
import { SocialService } from "./social.service";

/** What people say back, and who a reader hears it from. Every record here
 *  belongs to an identity store; Sloppy holds none of them. */
@Module({
  imports: [SyrModule, MediaModule, NodeRepositoryModule, IdentityModule],
  controllers: [SocialController, NoteConversationController],
  providers: [SocialService, PointerRepository, RefusalRepository],
})
export class SocialModule {}
