import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { BlockModule } from "./block/block.module";
import { AppConfigModule } from "./config/config.module";
import { DbModule } from "./db/db.module";
import { EmojiModule } from "./emoji/emoji.module";
import { HealthModule } from "./health/health.module";
import { IdpModule } from "./idp/idp.module";
import { MediaModule } from "./media/media.module";
import { NodeModule } from "./node/node.module";
import { PeerModule } from "./peer/peer.module";
import { ProfileModule } from "./profile/profile.module";
import { SocialModule } from "./social/social.module";

/**
 * The whole application, wired once. A milestone fills one of the modules
 * below rather than adding another; an entry earns its place only by owning a
 * concern none of the others does. docs/ARCHITECTURE.md § "Monorepo layout".
 */
@Module({
  imports: [
    AppConfigModule,
    DbModule,
    HealthModule,
    AuthModule,
    IdpModule.forRoot(),
    NodeModule,
    BlockModule,
    MediaModule,
    ProfileModule,
    EmojiModule,
    PeerModule,
    SocialModule,
  ],
})
export class AppModule {}
