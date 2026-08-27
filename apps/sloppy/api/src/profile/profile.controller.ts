import { Body, Controller, Get, Param, Patch, Req } from "@nestjs/common";
import {
  DidSyrSchema,
  type ProfileView,
  UpdateProfileRequestSchema,
} from "@sloppy/types";
import type { AuthedRequest } from "../auth/authed-request";
import { parseBody, parsePatch, viewerDelegation } from "../node/request";
import { ProfileService } from "./profile.service";

@Controller("profile")
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @Get("me")
  me(@Req() req: AuthedRequest): Promise<ProfileView> {
    const delegation = viewerDelegation(req);
    return this.profiles.read(
      delegation.syr_instance_url,
      parseBody(DidSyrSchema, delegation.did),
    );
  }

  @Patch("me")
  update(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): Promise<ProfileView> {
    return this.profiles.update(
      viewerDelegation(req),
      parsePatch(UpdateProfileRequestSchema, body),
    );
  }

  /**
   * Somebody else, as the reader's own instance can resolve them. An identity
   * held somewhere neither instance knows about is not readable yet — that is
   * what following a DID will do.
   */
  @Get(":did")
  read(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
  ): Promise<ProfileView> {
    return this.profiles.read(
      viewerDelegation(req).syr_instance_url,
      parseBody(DidSyrSchema, decodeURIComponent(did)),
    );
  }
}
