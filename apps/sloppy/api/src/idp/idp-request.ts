import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
} from "@nestjs/common";
import { type DelegationRow, IdpError, isIdpError } from "@sloppy/idp";
import type { Request, Response } from "express";
import type { z } from "zod";

/**
 * What the provider's guards attach. Both are absent on a route that asked for
 * neither, so a handler that reads one has said which guard it runs behind.
 */
export type IdpRequest = Request & {
  idpSession?: { did: string; sessionId: string };
  platform?: { did: string; delegation: DelegationRow };
};

/** The schemas in `@sloppy/idp` are the request contract, so a body is checked
 *  against one here rather than by a second set of DTO classes beside them. */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  throw new IdpError(
    400,
    "invalid_request",
    parsed.error.issues[0]?.message ?? "Check what you entered and try again.",
  );
}

/**
 * `IdpError` carries a machine code and a sentence for a person; this is where
 * they become the body `@sloppy/client` already reads.
 */
@Catch()
export class IdpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    if (!isIdpError(exception)) throw exception;
    respond(host, exception.status, {
      message: exception.message,
      code: exception.code,
    });
  }
}

/**
 * The same failure, on the endpoints the manifest declares. syr's consumers
 * branch on `error` and show `error_description`, so the codes have to arrive
 * under those names — the same codes under ours would parse as nothing.
 */
@Catch()
export class SyrExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    if (!isIdpError(exception)) throw exception;
    respond(host, exception.status, {
      error: exception.code,
      error_description: exception.message,
    });
  }
}

function respond(host: ArgumentsHost, status: number, body: object): void {
  host.switchToHttp().getResponse<Response>().status(status).json(body);
}
