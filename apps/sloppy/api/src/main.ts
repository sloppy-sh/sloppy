// Load the workspace .env before anything else is required — `env.ts` says why
// the order matters, and this import must stay first.
import "./config/env";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { AppConfigService } from "./config/app-config.service";
import { corsOrigin } from "./cors";

/**
 * How large a request may be. A section carries the editor's whole document and
 * a page of ink is tens of thousands of samples, so the framework's own 100 KB
 * would refuse a drawing somebody spent a minute on.
 */
const BODY_LIMIT = "8mb";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const logger = new Logger("Bootstrap");
  const config = app.get(AppConfigService);

  // What `req.ip` means. The asset route is public and rations fetches per
  // caller, so an instance that reads the last hop as the reader hands every
  // anonymous reader one shared ration — `AppConfigService.trustedProxies`.
  app.set("trust proxy", config.trustedProxies);

  app.useBodyParser("json", { limit: BODY_LIMIT });

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
