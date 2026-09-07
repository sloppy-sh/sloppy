import {
  type ArgumentsHost,
  Catch,
  HttpException,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import { CallTerminatedError, ConnectionUnavailableError } from "surrealdb";

/** What a caller is told for a failure that is not theirs to fix and that
 *  nobody wrote a sentence for. */
export const TRY_AGAIN =
  "Sloppy could not do that just now. Try again in a moment.";

/**
 * Every failure leaves here in Sloppy's words. It catches everything because
 * what it does not catch is answered "Internal server error" — a framework's
 * phrase, which reaches a surface as the server's own words and leaves the line
 * that surface wrote unreachable behind it.
 */
@Catch()
export class StoreUnavailableFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(StoreUnavailableFilter.name);

  catch(error: unknown, host: ArgumentsHost): void {
    if (
      error instanceof ConnectionUnavailableError ||
      error instanceof CallTerminatedError
    ) {
      super.catch(new ServiceUnavailableException(TRY_AGAIN), host);
      return;
    }
    if (error instanceof HttpException) {
      super.catch(error, host);
      return;
    }
    this.logger.error(error);
    super.catch(new InternalServerErrorException(TRY_AGAIN), host);
  }
}
