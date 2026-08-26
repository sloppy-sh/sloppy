import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import {
  type DidDocument,
  didDocument,
  LoginRequestSchema,
  login,
  logout,
  type Profile,
  profileOf,
  register,
  RegisterRequestSchema,
  requireIdentity,
  type SessionGrant,
} from "@sloppy/idp";
import { Public } from "../auth/public.decorator";
import { IdpExceptionFilter, type IdpRequest, parseBody } from "./idp-request";
import { IdpSessionGuard } from "./idp.guards";
import { IdpService } from "./idp.service";

/**
 * Accounts held by this instance, and the public reads a stranger makes about
 * one. `@Public()` throughout because Sloppy's own `AuthGuard` understands
 * Sloppy sessions, and these are the provider's — `IdpSessionGuard` is what
 * checks them.
 */
@Controller("idp")
@UseFilters(IdpExceptionFilter)
export class IdentityController {
  constructor(private readonly idp: IdpService) {}

  @Public()
  @Post("register")
  async register(@Body() body: unknown): Promise<SessionGrant> {
    return register(this.idp.context, parseBody(RegisterRequestSchema, body));
  }

  @Public()
  @HttpCode(200)
  @Post("login")
  async login(@Body() body: unknown): Promise<SessionGrant> {
    return login(this.idp.context, parseBody(LoginRequestSchema, body));
  }

  @Public()
  @UseGuards(IdpSessionGuard)
  @HttpCode(200)
  @Post("logout")
  async logout(@Req() request: IdpRequest): Promise<{ ok: true }> {
    await logout(this.idp.context, request.idpSession!);
    return { ok: true };
  }

  @Public()
  @UseGuards(IdpSessionGuard)
  @Get("me")
  async me(@Req() request: IdpRequest): Promise<Profile> {
    return profileOf(this.idp.context, request.idpSession!.did);
  }

  @Public()
  @Get("identity/:did/document")
  async document(@Param("did") did: string): Promise<DidDocument> {
    const context = this.idp.context;
    const identity = await requireIdentity(context, decodeURIComponent(did));
    return didDocument({
      did: identity.did,
      publicKeyMultibase: identity.public_key,
      provider: context.publicUrl,
    });
  }

  @Public()
  @Get("identity/:did/profile")
  async profile(@Param("did") did: string): Promise<Profile> {
    return profileOf(this.idp.context, decodeURIComponent(did));
  }

  /** Declared by the identity manifest, and empty because this provider stores
   *  no media yet. TODO(M2 media track): serve the blobs behind image and ink
   *  blocks from here. */
  @Public()
  @Get("identity/:did/uploads")
  async uploads(
    @Param("did") did: string,
  ): Promise<{ did: string; uploads: never[]; total: number }> {
    const identity = await requireIdentity(
      this.idp.context,
      decodeURIComponent(did),
    );
    return { did: identity.did, uploads: [], total: 0 };
  }
}
