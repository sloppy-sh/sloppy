import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { BlockModule } from "./block/block.module";
import { AppConfigModule } from "./config/config.module";
import { DbModule } from "./db/db.module";
import { HealthModule } from "./health/health.module";
import { IdpModule } from "./idp/idp.module";
import { NodeModule } from "./node/node.module";

/**
 * The whole application, wired once.
 *
 * **This file is closed.** Every milestone fills a module below rather than
 * adding one here, because a shared import list is the file four branches all
 * edit and then all conflict on. A feature that seems to need a new top-level
 * module belongs inside one of these.
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
  ],
})
export class AppModule {}
