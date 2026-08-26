import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import {
  ChallengeRequestSchema,
  type DelegationListing,
  delegationsOf,
  exchangeToken,
  IdpError,
  type RevokeOutcome,
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
import { type IdpRequest, parseBody, SyrExceptionFilter } from "./idp-request";
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
@Controller("idp/platform")
@UseFilters(SyrExceptionFilter)
export class PlatformController {
  constructor(private readonly idp: IdpService) {}

  @Public()
  @HttpCode(200)
  @Post("token")
  async token(@Body() body: unknown): Promise<SyrPlatformTokenResponse> {
    return exchangeToken(this.idp.context, parseBody(TokenRequestSchema, body));
  }

  @Public()
  @UseGuards(PlatformTokenGuard)
  @HttpCode(200)
  @Post("sign")
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
  @Post("challenge")
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

  @Public()
  @Get("delegations")
  async delegations(@Query("did") did?: string): Promise<DelegationListing> {
    if (!did) {
      throw new IdpError(
        400,
        "invalid_request",
        "Name an identity to look up.",
      );
    }
    return delegationsOf(this.idp.context, did);
  }

  /** Guarded by the person's session, not by a platform token: an app must not
   *  be able to disconnect itself, or anybody else. */
  @Public()
  @UseGuards(IdpSessionGuard)
  @HttpCode(200)
  @Post("revoke")
  async revoke(
    @Req() request: IdpRequest,
    @Body() body: unknown,
  ): Promise<RevokeOutcome> {
    return revoke(
      this.idp.context,
      request.idpSession!.did,
      parseBody(RevokeRequestSchema, body).platform_origin,
    );
  }
}
