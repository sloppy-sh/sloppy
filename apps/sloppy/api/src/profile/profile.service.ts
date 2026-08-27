import { Injectable } from "@nestjs/common";
import type {
  DidSyr,
  ProfileView,
  SyrProfile,
  UpdateProfileRequest,
} from "@sloppy/types";
import { type Delegation, SyrService } from "../syr/syr.service";

function viewOf(did: DidSyr, profile: SyrProfile): ProfileView {
  return {
    did,
    username: profile.username,
    display_name: profile.display_name ?? null,
    bio: profile.bio ?? null,
    avatar_url: profile.avatar_url ?? null,
    banner_url: profile.banner_url ?? null,
  };
}

/**
 * Profiles are the identity store's, read on demand and never written down
 * here — AI.md § "Sloppy's Vocabulary Stays Out of the Identity Store". A copy
 * in Sloppy's tables would be a second answer to "who is this", and the wrong
 * one the moment somebody changes their name.
 */
@Injectable()
export class ProfileService {
  constructor(private readonly syr: SyrService) {}

  /**
   * Anyone's, by DID. The instance is the one Sloppy already knows holds that
   * identity; resolving a stranger's provider is what pulling a subtree does,
   * and it hands the DID here once it has.
   */
  async read(instanceUrl: string, did: DidSyr): Promise<ProfileView> {
    return viewOf(did, await this.syr.readProfile(instanceUrl, did));
  }

  /** Read back rather than assembled from the patch: the store is free to
   *  refuse or trim what it was sent, and what it kept is the answer. */
  async update(
    delegation: Delegation,
    patch: UpdateProfileRequest,
  ): Promise<ProfileView> {
    await this.syr.updateProfile(delegation, patch);
    return this.read(delegation.syr_instance_url, delegation.did as DidSyr);
  }
}
