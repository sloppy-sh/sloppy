import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from "@nestjs/common";
import { IdpError, resolvePlatformToken, resolveSession } from "@sloppy/idp";
import type { IdpRequest } from "./idp-request";
import { IdpService } from "./idp.service";

function bearer(request: IdpRequest): string | null {
  const header = request.headers.authorization;
  if (!header || !/^Bearer\s+/i.test(header)) return null;
  return header.replace(/^Bearer\s+/i, "").trim() || null;
}

/** A person signed in to THIS instance. Separate from Sloppy's own `AuthGuard`
 *  because the provider's sessions are its own: a syr instance authenticates
 *  its account holders, and Sloppy is one of its consumers like any other. */
@Injectable()
export class IdpSessionGuard implements CanActivate {
  constructor(private readonly idp: IdpService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<IdpRequest>();
    const token = bearer(request);
    const session = token
      ? await resolveSession(this.idp.context, token)
      : null;
    if (!session) {
      throw new IdpError(401, "unauthorized", "Sign in to continue.");
    }
    request.idpSession = session;
    return true;
  }
}

/** An app holding a platform access token. Revocation and expiry are read on
 *  every request, so revoking stops the signing at once. */
@Injectable()
export class PlatformTokenGuard implements CanActivate {
  constructor(private readonly idp: IdpService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<IdpRequest>();
    const token = bearer(request);
    const grant = token
      ? await resolvePlatformToken(this.idp.context, token)
      : null;
    if (!grant) {
      throw new IdpError(
        401,
        "unauthorized",
        "Connect this app to your account again to continue.",
      );
    }
    request.platform = grant;
    return true;
  }
}
