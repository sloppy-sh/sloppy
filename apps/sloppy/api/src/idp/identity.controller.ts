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
  type DidDocument,
  didDocument,
  emojiCatalog,
  LoginRequestSchema,
  login,
  logout,
  type Profile,
  profileOf,
  type PublicListing,
  type PublicRecord,
  publicFollowing,
  publicUploadsOf,
  register,
  RegisterRequestSchema,
  requireIdentity,
  type SessionGrant,
} from "@sloppy/idp";
import type { SyrEmoji, SyrFollow } from "@sloppy/types";
import { Public } from "../auth/public.decorator";
import { IdpExceptionFilter, type IdpRequest, parseBody } from "./idp-request";
import { IdpSessionGuard } from "./idp.guards";
import { IdpService } from "./idp.service";
import { listing, pageOf, type UploadView, uploadView } from "./public-page";

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
  @Get("public/profile/:did")
  async profile(@Param("did") did: string): Promise<PublicRecord<Profile>> {
    return {
      status: "success",
      data: await profileOf(this.idp.context, decodeURIComponent(did)),
    };
  }

  /** What this identity keeps in the open: the pictures behind a note anyone
   *  may read, and the ones a peer needs to render a subtree they pulled. */
  @Public()
  @Get("public/uploads/:did")
  async uploads(
    @Param("did") did: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ): Promise<PublicListing<UploadView>> {
    const owner = await this.ownDid(did);
    const page = pageOf(limit, offset);
    const { rows, total } = await publicUploadsOf(
      this.idp.context,
      owner,
      page,
    );
    return listing(rows.map(uploadView), page, total);
  }

  @Public()
  @Get("public/emojis/:did")
  async emojis(
    @Param("did") did: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ): Promise<PublicListing<SyrEmoji>> {
    const owner = await this.ownDid(did);
    const page = pageOf(limit, offset);
    const { entries, total } = await emojiCatalog(
      this.idp.context,
      owner,
      page,
    );
    return listing(entries, page, total);
  }

  /**
   * Who this identity says PUBLICLY that they read. Who somebody reads is
   * theirs, so a follow is in here only where its owner said so; a reader
   * resolves a followed DID to the store that answers for it, which is why the
   * row carries one.
   */
  @Public()
  @Get("public/following/:did")
  async followedPublicly(
    @Param("did") did: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ): Promise<PublicListing<SyrFollow>> {
    const owner = await this.ownDid(did);
    const page = pageOf(limit, offset);
    const { entries, total } = await publicFollowing(
      this.idp.context,
      owner,
      page,
    );
    return listing(entries, page, total);
  }

  /**
   * Empty forever rather than not yet: what somebody writes here is nodes and
   * blocks in Sloppy's own tables, never a syr record — AI.md § "Sloppy's
   * Vocabulary Stays Out of the Identity Store". The routes exist because the
   * manifest names them, and a 404 where a manifest points reads as a broken
   * instance rather than as an identity with nothing to show.
   */
  @Public()
  @Get(["public/posts/:did", "public/stories/:did"])
  async syrOwnRecords(
    @Param("did") did: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ): Promise<PublicListing<never>> {
    return this.emptyPageFor(did, limit, offset);
  }

  private async emptyPageFor(
    did: string,
    limit?: string,
    offset?: string,
  ): Promise<PublicListing<never>> {
    await this.ownDid(did);
    return listing([], pageOf(limit, offset), 0);
  }

  /** Refuses first, so a DID this instance does not hold reads as unknown
   *  rather than as somebody with nothing to show. */
  private async ownDid(did: string): Promise<string> {
    return (await requireIdentity(this.idp.context, decodeURIComponent(did)))
      .did;
  }
}
