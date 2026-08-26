import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AppConfigService } from "./app-config.service";

/**
 * `ignoreEnvFile` because `env.ts` has already loaded the workspace `.env` into
 * `process.env`, earlier than a Nest module can — see the comment there. Two
 * loaders reading the same file is one loader too many.
 */
@Global()
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
