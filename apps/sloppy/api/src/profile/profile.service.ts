import { Injectable } from "@nestjs/common";
import type {
  ProfileView,
  SyrProfile,
  UpdateProfileRequest,
} from "@sloppy/types";
import { AssetLinks } from "../media/asset-link";
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
      avatar_url: profile.avatar_url ? this.links.to(profile.avatar_url) : null,
      banner_url: profile.banner_url ? this.links.to(profile.banner_url) : null,
    };
  }

  /** Read back rather than assembled from the patch: the store is free to
   *  refuse or trim what it was sent, and what it kept is the answer. */
  async update(
    delegation: Delegation,
    patch: UpdateProfileRequest,
  ): Promise<ProfileView> {
    await this.syr.updateProfile(delegation, {
      ...patch,
      ...this.pictureIn(patch, "avatar_url"),
      ...this.pictureIn(patch, "banner_url"),
    });
    return this.read(delegation.syr_instance_url, delegation.did);
  }

  /** What the store keeps is the address the picture actually lives at, so a
   *  surface sending back the link it was shown still saves the picture. */
  private pictureIn(
    patch: UpdateProfileRequest,
    field: "avatar_url" | "banner_url",
  ): Partial<UpdateProfileRequest> {
    const sent = patch[field];
    return sent ? { [field]: this.links.unwrap(sent) } : {};
  }
}
