import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Req,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import {
  approveConsent,
  ConsentApprovalSchema,
  type ConsentOutcome,
  type ConsentPrompt,
  ConsentRequestSchema,
  denyConsent,
  openConsent,
  providerApiBase,
  readConsent,
} from "@sloppy/idp";
import { Public } from "../auth/public.decorator";
import { consentPage } from "./consent-page";
import { IdpExceptionFilter, type IdpRequest, parseBody } from "./idp-request";
import { IdpSessionGuard } from "./idp.guards";
import { IdpService } from "./idp.service";

/**
 * The person deciding whether an app may act as them. The manifest points an
 * app at the page below; the endpoints under it are the page's own, which is
 * why they answer in Sloppy's dialect rather than syr's.
 */
@Controller("idp/consent")
@UseFilters(IdpExceptionFilter)
export class ConsentController {
  constructor(private readonly idp: IdpService) {}

  /** `manifest.platform.consent`. A person arrives here from an app, so this
   *  is the one route in the provider that answers a browser rather than a
   *  caller holding a token. */
  @Public()
  @Get()
  @Header("Content-Type", "text/html; charset=utf-8")
  page(): string {
    return consentPage(providerApiBase(this.idp.context.publicUrl));
  }

  @Public()
  @UseGuards(IdpSessionGuard)
  @Post()
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
  @Get(":challengeId")
  async read(
    @Req() request: IdpRequest,
    @Param("challengeId") challengeId: string,
  ): Promise<ConsentPrompt> {
    return readConsent(this.idp.context, request.idpSession!.did, challengeId);
  }

  @Public()
  @UseGuards(IdpSessionGuard)
  @HttpCode(200)
  @Post(":challengeId/approve")
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
  @Post(":challengeId/deny")
  async deny(
    @Req() request: IdpRequest,
    @Param("challengeId") challengeId: string,
  ): Promise<ConsentOutcome> {
    return denyConsent(this.idp.context, request.idpSession!.did, challengeId);
  }
}
