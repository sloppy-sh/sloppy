import { Module } from "@nestjs/common";
import { AmendmentModule } from "./amendment/amendment.module";
import { AuthModule } from "./auth/auth.module";
import { BlockModule } from "./block/block.module";
import { AppConfigModule } from "./config/config.module";
import { DbModule } from "./db/db.module";
import { EmojiModule } from "./emoji/emoji.module";
import { ExportModule } from "./export/export.module";
import { HealthModule } from "./health/health.module";
import { IdentityModule } from "./identity/identity.module";
import { IdpModule } from "./idp/idp.module";
import { MediaModule } from "./media/media.module";
import { NodeModule } from "./node/node.module";
import { PeerModule } from "./peer/peer.module";
import { ProfileModule } from "./profile/profile.module";
import { PublicationModule } from "./publication/publication.module";
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
    IdentityModule,
    NodeModule,
    BlockModule,
    AmendmentModule,
    PublicationModule,
    MediaModule,
    ProfileModule,
    EmojiModule,
    PeerModule,
    SocialModule,
    ExportModule,
  ],
})
export class AppModule {}
