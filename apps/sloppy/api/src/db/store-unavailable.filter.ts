import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Response } from "express";
import { CallTerminatedError, ConnectionUnavailableError } from "surrealdb";

/** What a caller is told when the store was not there to serve them. */
export const STORE_UNAVAILABLE =
  "Sloppy could not do that just now. Try again in a moment.";

/**
 * The store being away is not this request's fault and not a bug in it, so it
 * is answered as unavailable in words a person can act on — rather than as the
 * server error every repository would otherwise raise, whose only wording is
 * "Internal server error".
 */
@Catch(ConnectionUnavailableError, CallTerminatedError)
export class StoreUnavailableFilter implements ExceptionFilter {
  catch(_error: unknown, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<Response>().status(503).json({
      statusCode: 503,
      message: STORE_UNAVAILABLE,
      error: "Service Unavailable",
    });
  }
}
