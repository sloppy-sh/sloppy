import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  AnswerChallengeRequestSchema,
  type ConsentRedirect,
  ExchangeSessionRequestSchema,
  isPeerOrigin,
  type OwnInstance,
  type Session,
  type SignInChallenge,
  SignInChallengeRequestSchema,
  StartLoginRequestSchema,
  type Viewer,
} from "@sloppy/types";
import type { Response } from "express";
import { AppConfigService } from "../config/app-config.service";
import { ownOrigin } from "../media/remote-host";
import { normalizeInstanceUrl } from "../syr/syr.service";
import { AuthService, HOME } from "./auth.service";
import { type AuthedRequest, SESSION_UNVERIFIED } from "./authed-request";
import { CallerRate, callerOf } from "./caller-rate";
import { handOffPage } from "./hand-off-page";
import { KeySignInService } from "./key-sign-in.service";
import { Public } from "./public.decorator";
import { isAllowedRedirect, isDeepLink, withParams } from "./redirect-target";
import {
  clearSessionCookie,
  readCredential,
  setSessionCookie,
} from "./session-cookie";

/** Per caller: enough to get a signature wrong a few times and start again,
 *  not enough to work through somebody else's addresses. */
const SIGN_INS_AT_ONCE = 20;
const SIGN_INS_PER_SEC = 0.2;

/**
 * The two ways in: the syr identity somebody already has, and a key of their
 * own over an address they already go by — docs/ARCHITECTURE.md § "Auth:
 * Platform Delegation v0.1" and § "Signing in with a key of your own".
 *
 * The callback below lands on this API and never on a shell, under the origin
 * rule `AuthService.platformOrigin` holds. What happens next depends only on
 * whether the shell shares this origin: the browser can be given the session
 * outright, and everything else is handed the code to spend.
 *
 * Every route is `@Public()`: they are how a session begins, and `/auth/me`
 * answers "nobody" rather than refusing, so the first visit is not an error.
 * Nobody is what an absent credential means, though, never what an unreadable
 * store means — a session Sloppy cannot check is reported as such, and the
 * routes that need no session at all still answer while it is down.
 */
@Controller("auth")
export class AuthController {
  /** Both doors below answer without a session and both cost a signature check
   *  on the way in, so what one caller may spend on them is bounded. */
  private readonly rate = new CallerRate({
    capacity: SIGN_INS_AT_ONCE,
    perSecond: SIGN_INS_PER_SEC,
  });

  constructor(
    private readonly auth: AuthService,
    private readonly keySignIn: KeySignInService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Where somebody with no identity anywhere can make one, or `null` where this
   * Sloppy only ever delegates — and where a peer reaches the graph this
   * instance serves, which is the other half of what a person hands somebody
   * they want to be read by. Asked through the API rather than read off the
   * origin, because the shells reach an instance that may share neither.
   */
  @Public()
  @Get("own-instance")
  ownInstance(): OwnInstance {
    const origin = ownOrigin(this.config.publicUrl);
    return {
      instance_url: this.auth.ownInstanceUrl(),
      ...(origin && isPeerOrigin(origin) ? { instance_origin: origin } : {}),
    };
  }

  @Public()
  @HttpCode(200)
  @Post("login")
  async login(@Body() body: unknown): Promise<ConsentRedirect> {
    const raw = (body ?? {}) as { instance_url?: unknown; redirect?: unknown };
    const redirect = typeof raw.redirect === "string" ? raw.redirect : "";
    const request = StartLoginRequestSchema.safeParse({
      instance_url:
        typeof raw.instance_url === "string"
          ? normalizeInstanceUrl(raw.instance_url)
          : raw.instance_url,
      ...(redirect ? { redirect } : {}),
    });
    if (!request.success) {
      throw new BadRequestException(
        "Enter the address where your identity lives.",
      );
    }
    try {
      return { consent_url: await this.auth.consentRedirect(request.data) };
    } catch (err) {
      // Reaching our OWN provider and failing is this instance being unwell, not
      // a bad address — and the person who pressed "Start here" never typed one,
      // so telling them to check it sends them to fix the wrong thing.
      if (request.data.instance_url === this.auth.ownInstanceUrl()) {
        throw new ServiceUnavailableException(
          "Sloppy could not set up an account just now. Try again in a moment.",
        );
      }
      throw err;
    }
  }

  /**
   * Something to sign, for somebody who goes by an address rather than by an
   * identity Sloppy can delegate to. Neither this nor the answer below says
   * whether a key was found for the address it is given: what comes back when
   * a sign-in does not settle reads the same either way.
   */
  @Public()
  @HttpCode(200)
  @Post("challenge")
  challenge(@Req() req: AuthedRequest, @Body() body: unknown): SignInChallenge {
    this.charge(req);
    const request = SignInChallengeRequestSchema.safeParse(body ?? {});
    if (!request.success) {
      throw new BadRequestException("Enter an email address.");
    }
    return this.keySignIn.challenge(request.data.principal);
  }

  /** The signed answer. A session comes back in the body rather than in a
   *  cookie: this is asked by the app itself on every surface, never landed on
   *  as a navigation the way consent is. */
  @Public()
  @HttpCode(200)
  @Post("answer")
  async answer(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): Promise<Session> {
    this.charge(req);
    const request = AnswerChallengeRequestSchema.safeParse(body ?? {});
    if (!request.success) {
      throw new BadRequestException(
        "Paste the signature for the text above, then try again.",
      );
    }
    return this.keySignIn.answer(request.data);
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
    if (req.sessionUnverified)
      throw new ServiceUnavailableException(SESSION_UNVERIFIED);
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
    // Cleared before the session is ended, and kept cleared if ending it fails:
    // somebody who wants out gets out of this browser either way.
    clearSessionCookie(res);
    try {
      if (credential) await this.auth.signOut(credential);
    } catch {
      throw new ServiceUnavailableException(
        "You're signed out here. Sloppy could not finish signing you out — try again in a moment.",
      );
    }
    return {};
  }

  private charge(req: AuthedRequest): void {
    if (!this.rate.take(callerOf(req))) {
      throw new HttpException(
        "Too many tries. Wait a moment, then start again.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
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
