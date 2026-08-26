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
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(exception.status)
      .json({ message: exception.message, code: exception.code });
  }
}
