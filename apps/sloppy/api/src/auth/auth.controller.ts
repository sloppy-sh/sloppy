import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import {
  type ConsentRedirect,
  ExchangeSessionRequestSchema,
  type Session,
  StartLoginRequestSchema,
  type Viewer,
} from "@sloppy/types";
import type { Response } from "express";
import { normalizeInstanceUrl } from "../syr/syr.service";
import { AuthService, HOME } from "./auth.service";
import type { AuthedRequest } from "./authed-request";
import { handOffPage } from "./hand-off-page";
import { Public } from "./public.decorator";
import { isAllowedRedirect, isDeepLink, withParams } from "./redirect-target";
import {
  clearSessionCookie,
  readCredential,
  setSessionCookie,
} from "./session-cookie";

/**
 * Signing in with the syr identity somebody already has —
 * docs/ARCHITECTURE.md § "Auth: Platform Delegation v0.1".
 *
 * The callback below lands on this API and never on a shell, under the origin
 * rule `AuthService.platformOrigin` holds. What happens next depends only on
 * whether the shell shares this origin: the browser can be given the session
 * outright, and everything else is handed the code to spend.
 *
 * Every route is `@Public()`: they are how a session begins, and `/auth/me`
 * answers "nobody" rather than refusing, so the first visit is not an error.
 */
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @HttpCode(200)
  @Post("login")
  async login(@Body() body: unknown): Promise<ConsentRedirect> {
    const raw = (body ?? {}) as { instance_url?: unknown; redirect?: unknown };
    const request = StartLoginRequestSchema.safeParse({
      instance_url:
        typeof raw.instance_url === "string"
          ? normalizeInstanceUrl(raw.instance_url)
          : raw.instance_url,
      ...(typeof raw.redirect === "string" ? { redirect: raw.redirect } : {}),
    });
    if (!request.success) {
      throw new BadRequestException(
        "Enter the address of the instance your identity lives on.",
      );
    }
    return { consent_url: await this.auth.consentRedirect(request.data) };
  }

  @Public()
  @Get("callback")
  async callback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("delegation_id") delegationId: string | undefined,
    @Query("error") error: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const consent = state ? this.auth.readConsentState(state) : null;
    if (!consent) {
      this.giveUp(res, HOME, "Sign-in took too long. Start again.");
      return;
    }

    const target = isAllowedRedirect(consent.redirect)
      ? consent.redirect
      : HOME;

    if (error) {
      this.giveUp(
        res,
        target,
        "Sloppy was not approved, so you are not signed in.",
      );
      return;
    }
    if (!code || !delegationId) {
      this.giveUp(res, target, "Sign-in did not finish. Try again.");
      return;
    }

    // A shell on another origin cannot be handed a cookie, so it is handed the
    // code instead and finishes at `/auth/exchange`.
    if (!target.startsWith("/")) {
      this.leave(
        res,
        withParams(target, {
          sloppy_code: code,
          sloppy_state: this.auth.issueHandOff(consent.inst, delegationId),
        }),
        "You're signed in",
      );
      return;
    }

    try {
      const session = await this.auth.signIn(consent.inst, code, delegationId);
      setSessionCookie(res, session.token, session.expires_at, this.secure);
      res.redirect(target);
    } catch (err) {
      this.giveUp(res, target, this.reason(err));
    }
  }

  @Public()
  @Post("exchange")
  async exchange(@Body() body: unknown): Promise<Session> {
    const request = ExchangeSessionRequestSchema.safeParse(body);
    if (!request.success) {
      throw new BadRequestException("Sign-in did not finish. Try again.");
    }
    return this.auth.signInFromHandOff(request.data.code, request.data.state);
  }

  // Who is signed in changes without the URL changing, and a cache that kept
  // this answer would go on naming somebody after they signed out.
  @Header("cache-control", "no-store")
  @Public()
  @Get("me")
  me(@Req() req: AuthedRequest): Viewer | null {
    return req.viewer ?? null;
  }

  @Public()
  @HttpCode(200)
  @Post("logout")
  async logout(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Record<string, never>> {
    const credential = readCredential(req);
    if (credential) await this.auth.signOut(credential);
    clearSessionCookie(res);
    return {};
  }

  private get secure(): boolean {
    return new URL(this.auth.callbackUrl).protocol === "https:";
  }

  /** Where an Android browser goes when it cannot reach the app itself. */
  private get homeUrl(): string {
    return new URL(HOME, this.auth.callbackUrl).toString();
  }

  /** The message a person reads, from a server that wrote one for them. */
  private reason(err: unknown): string {
    if (err instanceof HttpException) {
      const body = err.getResponse();
      const message =
        typeof body === "string"
          ? body
          : (body as { message?: unknown })?.message;
      if (typeof message === "string") return message;
    }
    return "Sign-in did not finish. Try again.";
  }

  private giveUp(res: Response, target: string, message: string): void {
    this.leave(
      res,
      withParams(target, { sloppy_error: message }),
      "Back to Sloppy",
    );
  }

  /** The one way out of the callback, so no ending is left in the browser. */
  private leave(res: Response, target: string, heading: string): void {
    if (isDeepLink(target)) {
      res
        .status(200)
        .type("html")
        .send(handOffPage(target, this.homeUrl, heading));
    } else {
      res.redirect(target);
    }
  }
}
