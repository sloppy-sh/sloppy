import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import {
  addEmoji,
  EmojiCreateSchema,
  emojiCatalog,
  finishUpload,
  FolderCreateSchema,
  foldersUnder,
  type FolderView,
  IdpError,
  makeFolder,
  openUpload,
  type Profile,
  ProfilePatchSchema,
  removeEmoji,
  requireUpload,
  updateProfile,
  UploadCompleteSchema,
  UploadCreateSchema,
  type UploadTicket,
} from "@sloppy/idp";
import type { SyrEmoji } from "@sloppy/types";
import type { Response } from "express";
import { Public } from "../auth/public.decorator";
import {
  IdpExceptionFilter,
  type IdpRequest,
  parseBody,
  writingPlatform,
} from "./idp-request";
import { PlatformTokenGuard } from "./idp.guards";
import { IdpService } from "./idp.service";
import { pageOf, type UploadView, uploadView } from "./public-page";

/**
 * What an app holding a delegation may do with the person's own files, emoji
 * and profile — syr's `/api/folders`, `/api/uploads`, `/api/emojis` and
 * `/api/user/profile`, so the same client code reaches this instance and a real
 * one. `@sloppy/idp` owns the rules; this is the wire in front of them.
 *
 * `@Public()` throughout because Sloppy's `AuthGuard` reads Sloppy sessions and
 * these routes read the provider's delegations.
 */
@Controller("idp")
@Public()
@UseFilters(IdpExceptionFilter)
@UseGuards(PlatformTokenGuard)
export class OwnerController {
  constructor(private readonly idp: IdpService) {}

  @Get("folders")
  async folders(
    @Req() req: IdpRequest,
    @Query("parent_id") parentId?: string,
  ): Promise<{ status: "success"; data: { folders: FolderView[] } }> {
    const folders = await foldersUnder(
      this.idp.context,
      req.platform!.did,
      parentId,
    );
    return { status: "success", data: { folders } };
  }

  @Post("folders")
  async createFolder(
    @Req() req: IdpRequest,
    @Body() body: unknown,
  ): Promise<{ status: "success"; data: FolderView }> {
    const grant = writingPlatform(req);
    return {
      status: "success",
      data: await makeFolder(
        this.idp.context,
        grant.did,
        parseBody(FolderCreateSchema, body),
      ),
    };
  }

  @Post("uploads")
  async createUpload(
    @Req() req: IdpRequest,
    @Body() body: unknown,
  ): Promise<{ status: "success"; data: UploadTicket }> {
    const grant = writingPlatform(req);
    return {
      status: "success",
      data: await openUpload(
        this.idp.context,
        grant.did,
        parseBody(UploadCreateSchema, body),
      ),
    };
  }

  /**
   * Told the bytes are there. `202` while they are not, which is the answer a
   * caller retries rather than reports — the same shape syr gives while its own
   * store is catching up.
   */
  @Patch("uploads")
  async completeUpload(
    @Req() req: IdpRequest,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const grant = writingPlatform(req);
    const request = parseBody(UploadCompleteSchema, body);
    if (request.did !== grant.did) throw notYours();

    const row = await finishUpload(
      this.idp.context,
      grant.did,
      request.local_id,
    );
    if (!row) {
      res.status(202).json({ status: "finalizing" });
      return;
    }
    res.status(200).json({ status: "success", data: uploadView(row) });
  }

  @Get("uploads/:did/:localId")
  async readUpload(
    @Req() req: IdpRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
  ): Promise<{ status: "success"; data: UploadView }> {
    if (decodeURIComponent(did) !== req.platform!.did) throw notYours();
    const row = await requireUpload(
      this.idp.context,
      req.platform!.did,
      decodeURIComponent(localId),
    );
    return { status: "success", data: uploadView(row) };
  }

  @Get("emojis")
  async emoji(
    @Req() req: IdpRequest,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ): Promise<{ status: "success"; data: SyrEmoji[] }> {
    const page = pageOf(limit, offset);
    const { entries } = await emojiCatalog(
      this.idp.context,
      req.platform!.did,
      page,
    );
    return { status: "success", data: entries };
  }

  @Post("emojis")
  async createEmoji(
    @Req() req: IdpRequest,
    @Body() body: unknown,
  ): Promise<{ status: "success"; data: SyrEmoji }> {
    const grant = writingPlatform(req);
    return {
      status: "success",
      data: await addEmoji(
        this.idp.context,
        grant.did,
        parseBody(EmojiCreateSchema, body),
      ),
    };
  }

  @Delete("emojis/:did/:localId")
  @HttpCode(204)
  async deleteEmoji(
    @Req() req: IdpRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
  ): Promise<void> {
    const grant = writingPlatform(req);
    if (decodeURIComponent(did) !== grant.did) throw notYours();
    await removeEmoji(this.idp.context, grant.did, decodeURIComponent(localId));
  }

  @Patch("user/profile")
  async patchProfile(
    @Req() req: IdpRequest,
    @Body() body: unknown,
  ): Promise<{ status: "success"; data: { profile: Profile } }> {
    const grant = writingPlatform(req);
    const profile = await updateProfile(
      this.idp.context,
      grant.did,
      parseBody(ProfilePatchSchema, body),
    );
    return { status: "success", data: { profile } };
  }
}

function notYours(): IdpError {
  return new IdpError(404, "not_found", "That is not there.");
}
