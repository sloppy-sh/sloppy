import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import {
  approveConsent,
  ChallengeRequestSchema,
  ConsentApprovalSchema,
  type ConsentOutcome,
  type ConsentPrompt,
  ConsentRequestSchema,
  type DelegationInfo,
  delegationsOf,
  denyConsent,
  exchangeToken,
  IdpError,
  openConsent,
  readConsent,
  RevokeRequestSchema,
  revoke,
  SignRequestSchema,
  signChallenge,
  signPayload,
  TokenRequestSchema,
} from "@sloppy/idp";
import type {
  SyrPlatformChallengeResponse,
  SyrPlatformSignResponse,
  SyrPlatformTokenResponse,
} from "@sloppy/types";
import { Public } from "../auth/public.decorator";
import { IdpExceptionFilter, type IdpRequest, parseBody } from "./idp-request";
import { IdpSessionGuard, PlatformTokenGuard } from "./idp.guards";
import { IdpService } from "./idp.service";

/**
 * Platform Delegation v0.1, served. An app that can talk to a syr instance can
 * talk to this one, which is what lets Sloppy point its own sign-in at itself
 * and still be pointing at syr's contracts.
 *
 * These paths are not to be assumed by a caller — `/.well-known/syr` is where a
 * consumer learns them.
 */
@Controller("idp")
@UseFilters(IdpExceptionFilter)
export class PlatformController {
  constructor(private readonly idp: IdpService) {}

  // ── The person deciding ─────────────────────────────────────────────────

  @Public()
  @UseGuards(IdpSessionGuard)
  @Post("consent")
  async open(
    @Req() request: IdpRequest,
    @Body() body: unknown,
  ): Promise<ConsentPrompt> {
    return openConsent(
      this.idp.context,
      request.idpSession!.did,
      parseBody(ConsentRequestSchema, body),
    );
  }

  @Public()
  @UseGuards(IdpSessionGuard)
  @Get("consent/:challengeId")
  async read(
    @Req() request: IdpRequest,
    @Param("challengeId") challengeId: string,
  ): Promise<ConsentPrompt> {
    return readConsent(this.idp.context, request.idpSession!.did, challengeId);
  }

  @Public()
  @UseGuards(IdpSessionGuard)
  @HttpCode(200)
  @Post("consent/:challengeId/approve")
  async approve(
    @Req() request: IdpRequest,
    @Param("challengeId") challengeId: string,
    @Body() body: unknown,
  ): Promise<ConsentOutcome> {
    return approveConsent(
      this.idp.context,
      request.idpSession!.did,
      challengeId,
      parseBody(ConsentApprovalSchema, body).password,
    );
  }

  @Public()
  @UseGuards(IdpSessionGuard)
  @HttpCode(200)
  @Post("consent/:challengeId/deny")
  async deny(
    @Req() request: IdpRequest,
    @Param("challengeId") challengeId: string,
  ): Promise<ConsentOutcome> {
    return denyConsent(this.idp.context, request.idpSession!.did, challengeId);
  }

  @Public()
  @UseGuards(IdpSessionGuard)
  @HttpCode(200)
  @Post("platform/revoke")
  async revoke(
    @Req() request: IdpRequest,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    await revoke(
      this.idp.context,
      request.idpSession!.did,
      parseBody(RevokeRequestSchema, body).platform_origin,
    );
    return { ok: true };
  }

  // ── The app ─────────────────────────────────────────────────────────────

  @Public()
  @HttpCode(200)
  @Post("platform/token")
  async token(@Body() body: unknown): Promise<SyrPlatformTokenResponse> {
    return exchangeToken(this.idp.context, parseBody(TokenRequestSchema, body));
  }

  @Public()
  @UseGuards(PlatformTokenGuard)
  @HttpCode(200)
  @Post("platform/sign")
  sign(
    @Req() request: IdpRequest,
    @Body() body: unknown,
  ): SyrPlatformSignResponse {
    return signPayload(
      this.idp.context,
      request.platform!.delegation,
      parseBody(SignRequestSchema, body).payload,
    );
  }

  @Public()
  @UseGuards(PlatformTokenGuard)
  @HttpCode(200)
  @Post("platform/challenge")
  challenge(
    @Req() request: IdpRequest,
    @Body() body: unknown,
  ): SyrPlatformChallengeResponse {
    const asked = parseBody(ChallengeRequestSchema, body);
    const { delegation } = request.platform!;
    // The token names one delegation; signing under another one's key on its
    // say-so would make this endpoint a signing oracle for any account.
    if (
      delegation.did !== asked.did ||
      delegation.platform_origin !== asked.platform_origin
    ) {
      throw new IdpError(
        403,
        "delegation_mismatch",
        "Connect this app to your account again to continue.",
      );
    }
    return signChallenge(this.idp.context, delegation, asked.challenge);
  }

  // ── Anyone verifying a signature ────────────────────────────────────────

  @Public()
  @Get("platform/delegations")
  async delegations(@Query("did") did?: string): Promise<DelegationInfo[]> {
    if (!did) {
      throw new IdpError(
        400,
        "invalid_request",
        "Name an identity to look up.",
      );
    }
    return delegationsOf(this.idp.context, did);
  }
}
