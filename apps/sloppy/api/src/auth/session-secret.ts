import { randomBytes } from "node:crypto";
import { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";

/** The key every short-lived sign-in token here is signed with. */
export const SESSION_SECRET = Symbol("session secret");

/**
 * Configured, or one that lasts as long as this process — which is a sign-in
 * already in flight not surviving a restart, and several API processes each
 * refusing what the others issued.
 */
export function sessionSecret(config: ConfigService): string {
  const configured = config.get<string>("SLOPPY_SESSION_SECRET");
  if (configured) return configured;
  new Logger("Auth").warn(
    "SLOPPY_SESSION_SECRET is unset; using a key that lasts as long as this process. A sign-in already in flight will not survive a restart.",
  );
  return randomBytes(32).toString("hex");
}
