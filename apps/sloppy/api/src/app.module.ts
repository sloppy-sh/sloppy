import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { BlockModule } from "./block/block.module";
import { AppConfigModule } from "./config/config.module";
import { DbModule } from "./db/db.module";
import { HealthModule } from "./health/health.module";
import { IdpModule } from "./idp/idp.module";
import { NodeModule } from "./node/node.module";

/**
 * The whole application, wired once. **This file is closed:** a milestone fills
 * one of the modules below rather than adding another to the list.
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
  ],
})
export class AppModule {}
