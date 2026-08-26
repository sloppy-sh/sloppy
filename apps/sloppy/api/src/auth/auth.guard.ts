import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthService } from "./auth.service";
import type { AuthedRequest } from "./authed-request";
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
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const credential = readCredential(request);
    if (credential) {
      const session = await this.auth.resolve(credential);
      if (session) {
        request.viewer = viewerOf(session);
        request.delegation = delegationOf(session);
      }
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    if (!request.viewer)
      throw new UnauthorizedException("Sign in to continue.");
    return true;
  }
}
