// Load the workspace .env before anything else is required — `env.ts` says why
// the order matters, and this import must stay first.
import "./config/env";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { AppConfigService } from "./config/app-config.service";
import { corsOrigin } from "./cors";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger("Bootstrap");
  const config = app.get(AppConfigService);

  // One prefix, so the API can share a domain with the web app; clients point
  // at `<origin>/api` and `@sloppy/client`'s `apiUrl` adds the rest.
  //
  // syr's discovery documents are excluded because a federated consumer
  // resolves them at the site ROOT — `{origin}/.well-known/syr[/:did]`, never
  // under /api. The embedded IdP is what will serve them.
  app.setGlobalPrefix("api", {
    exclude: ["/.well-known/syr", "/.well-known/syr/:did"],
  });

  app.enableCors({
    credentials: true,
    origin: corsOrigin({
      allowedOrigins: config.allowedOrigins,
      isProduction: config.isProduction,
      warn: (message) => logger.warn(message),
    }),
  });

  // Without this, every `onModuleDestroy` in the tree is dead code when the
  // process is simply stopped — the database connection included.
  app.enableShutdownHooks();

  await app.listen(config.port);
  logger.log(`Sloppy API listening on ${config.publicUrl}`);
}

void bootstrap();
