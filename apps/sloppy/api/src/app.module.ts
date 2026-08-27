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
import { ProfileModule } from "./profile/profile.module";

/**
 * The whole application, wired once. A milestone fills one of the modules
 * below; a new entry earns its place by owning a concern none of them does —
 * the three at the foot of this list stand between Sloppy and the identity
 * store, which is nothing the graph modules above them know about.
 * docs/ARCHITECTURE.md § "Monorepo layout".
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
  ],
})
export class AppModule {}
