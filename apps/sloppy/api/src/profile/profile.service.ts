import { Injectable } from "@nestjs/common";
import type {
  ProfileView,
  SyrProfile,
  SyrProfilePatch,
  UpdateProfileRequest,
} from "@sloppy/types";
import { AssetLinks } from "../media/asset-link";
import { MediaService } from "../media/media.service";
import { type Delegation, SyrService } from "../syr/syr.service";

/**
 * Profiles are the identity store's, read on demand and never written down
 * here — AI.md § "Sloppy's Vocabulary Stays Out of the Identity Store". A copy
 * in Sloppy's tables would be a second answer to "who is this", and the wrong
 * one the moment somebody changes their name.
 */
@Injectable()
export class ProfileService {
  constructor(
    private readonly syr: SyrService,
    private readonly media: MediaService,
    private readonly links: AssetLinks,
  ) {}

  /**
   * Anyone's, by DID. The instance is the one Sloppy already knows holds that
   * identity; resolving a stranger's provider is what pulling a subtree does,
   * and it hands the DID here once it has.
   */
  async read(instanceUrl: string, did: string): Promise<ProfileView> {
    return this.viewOf(did, await this.syr.readProfile(instanceUrl, did));
  }

  /** The pictures come back as addresses on this instance: a reader loading a
   *  profile must not reach the machine that holds them. */
  private viewOf(did: string, profile: SyrProfile): ProfileView {
    return {
      did,
      username: profile.username,
      display_name: profile.display_name ?? null,
      bio: profile.bio ?? null,
      avatar_src: profile.avatar_url ? this.links.to(profile.avatar_url) : null,
      banner_src: profile.banner_url ? this.links.to(profile.banner_url) : null,
    };
  }

  /** Read back rather than assembled from the patch: the store is free to
   *  refuse or trim what it was sent, and what it kept is the answer. */
  async update(
    delegation: Delegation,
    patch: UpdateProfileRequest,
  ): Promise<ProfileView> {
    const sent: SyrProfilePatch = {};
    if ("display_name" in patch) sent.display_name = patch.display_name;
    if ("bio" in patch) sent.bio = patch.bio;
    if ("avatar_upload_id" in patch) {
      sent.avatar_url = await this.stored(delegation, patch.avatar_upload_id);
    }
    if ("banner_upload_id" in patch) {
      sent.banner_url = await this.stored(delegation, patch.banner_upload_id);
    }
    await this.syr.updateProfile(delegation, sent);
    return this.read(delegation.syr_instance_url, delegation.did);
  }

  /**
   * Where one of the caller's own uploads actually lives, or `null` to clear
   * the picture. Read back from their store rather than taken from the request,
   * so a profile can only ever point at a picture that identity holds.
   */
  private async stored(
    delegation: Delegation,
    uploadId: string | null | undefined,
  ): Promise<string | null> {
    return uploadId ? this.media.ownPicture(delegation, uploadId) : null;
  }
}
