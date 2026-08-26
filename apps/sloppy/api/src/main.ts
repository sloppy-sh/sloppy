// Load the workspace .env before anything else is required — `env.ts` says why
// the order matters, and this import must stay first.
import "./config/env";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { AppConfigService } from "./config/app-config.service";

/** RFC1918 and loopback. Development only. */
const DEV_LAN = [
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  /^localhost$/i,
  /^127\.0\.0\.1$/,
];

function isDevLanOrigin(origin: string): boolean {
  try {
    return DEV_LAN.some((re) => re.test(new URL(origin).hostname));
  } catch {
    return false;
  }
}

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

  // Who may make a CREDENTIALED cross-origin request. `credentials: true` lets
  // the calling page read the response, so reflecting every origin would hand
  // any site on the internet a readable session belonging to whoever visits it.
  // The list is closed in production; development additionally allows loopback
  // and RFC1918, because the shells are served from another port on the same
  // machine — but only those, never any origin.
  const allowed = new Set([
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    ...config.allowedOrigins,
  ]);
  const denied = new Set<string>();
  const isProduction = config.isProduction;

  app.enableCors({
    credentials: true,
    origin(
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) {
      // No Origin header at all: a same-origin navigation, curl, or the
      // server-to-server fetch federation actually runs on.
      if (!origin) return callback(null, true);
      if (allowed.has(origin)) return callback(null, true);
      if (!isProduction && isDevLanOrigin(origin)) return callback(null, true);
      // `false`, not an Error: omitting the header is the correct refusal, and
      // throwing would turn a blocked page into a 500 in our own logs. Logged
      // once per origin, so a misconfigured client is visible without handing
      // anyone a way to fill the disk.
      if (!denied.has(origin)) {
        denied.add(origin);
        logger.warn(
          `CORS: denied ${origin} — add it to SLOPPY_ALLOWED_ORIGINS if it is one of yours`,
        );
      }
      return callback(null, false);
    },
  });

  // Without this, every `onModuleDestroy` in the tree is dead code when the
  // process is simply stopped — the database connection included.
  app.enableShutdownHooks();

  await app.listen(config.port);
  logger.log(`Sloppy API listening on ${config.publicUrl}`);
}

void bootstrap();
