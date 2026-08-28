import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthService } from "./auth.service";
import { type AuthedRequest, SESSION_UNVERIFIED } from "./authed-request";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { readCredential } from "./session-cookie";
import { delegationOf, viewerOf } from "./session.store";

/**
 * Registered as an `APP_GUARD`, so it covers every route in the application and
 * a new controller is protected the moment it is written rather than when
 * somebody remembers a decorator.
 *
 * A `@Public()` route still gets the viewer when one is presented: `/auth/me`
 * is public precisely so that "nobody is signed in" can be an answer instead of
 * a refusal, and it cannot answer without looking.
 *
 * Where the session store cannot say whom a credential names, the answer is
 * neither this person nor nobody. A protected route is refused as unavailable —
 * never as unauthorized, which is a client's signal that its credential is dead
 * and its cue to erase one that still works. A public route runs on, and reads
 * `sessionUnverified` if the difference is one it has to make.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const credential = readCredential(request);
    if (credential) {
      try {
        const session = await this.auth.resolve(credential);
        if (session) {
          request.viewer = viewerOf(session);
          request.delegation = delegationOf(session);
        }
      } catch (err) {
        request.sessionUnverified = true;
        this.logger.error(
          `Could not check a credential: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    if (request.sessionUnverified)
      throw new ServiceUnavailableException(SESSION_UNVERIFIED);
    if (!request.viewer)
      throw new UnauthorizedException("Sign in to continue.");
    return true;
  }
}
