import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "./public.decorator";

/**
 * Registered as an `APP_GUARD`, so it covers every route in the application and
 * a new controller is protected the moment it is written rather than when
 * somebody remembers a decorator.
 *
 * It fails CLOSED: with no session store yet, only `@Public()` routes answer.
 * That is the safe half of the contract to land first — a guard that let
 * everything through until auth arrived would make every route between now and
 * then look like it worked.
 *
 * TODO(M1 auth track): resolve the session — cookie or bearer — through
 * Platform Delegation and attach the viewer to the request.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    throw new UnauthorizedException("Sign in to continue.");
  }
}
