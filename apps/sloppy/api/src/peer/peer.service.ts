// Following somebody, and asking an instance what they publish there.
//
// Both run here rather than in the browser: a browser resolving a peer's
// provider, or asking their instance for a listing, tells that instance who is
// reading — which is the leak `proxied()` exists to prevent.

import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  type FollowedIdentity,
  type PeerPublicationsQuery,
  type PublishedIndex,
  UnaskedAnswerError,
  parsePublishedIndex,
} from "@sloppy/types";
import { AppConfigService } from "../config/app-config.service";
import type { Delegation } from "../syr/syr.service";
import { SyrService } from "../syr/syr.service";
import {
  hereOrigin,
  peerReach,
  publicationsUrl,
  readPeerJson,
} from "./peer-fetch";

/** Said where somebody's own store keeps no list of who they follow. They can
 *  still pull a branch, so the line says which of the two they have. */
const NO_FOLLOW_LIST =
  "This account cannot keep a list of who you follow. You can still pull a branch by its address.";

@Injectable()
export class PeerService {
  constructor(
    private readonly config: AppConfigService,
    private readonly syr: SyrService,
  ) {}

  /**
   * Who the reader follows, from their own identity store — AI.md § "Sloppy's
   * Vocabulary Stays Out of the Identity Store". A store that keeps no follow
   * list has none rather than an empty one, and answers as much.
   */
  async following(delegation: Delegation): Promise<FollowedIdentity[]> {
    if (!(await this.keepsFollows(delegation))) return [];
    const rows = await this.syr.listFollowing(delegation);
    return rows.map((row) => ({
      did: row.followed_did,
      provider_url: row.followed_provider_url ?? null,
    }));
  }

  /**
   * A follow, written to the reader's own store. Where that identity lives is
   * resolved here and recorded beside the DID, so reading them later starts at
   * their own instance rather than from scratch.
   */
  async follow(delegation: Delegation, did: string): Promise<void> {
    if (did === delegation.did) {
      throw new BadRequestException("You are already reading your own graph.");
    }
    if (!(await this.keepsFollows(delegation))) {
      throw new BadRequestException(NO_FOLLOW_LIST);
    }
    const provider = await this.syr.providerFor(
      delegation.syr_instance_url,
      did,
    );
    await this.syr.follow(delegation, did, provider ?? undefined);
  }

  async unfollow(delegation: Delegation, did: string): Promise<void> {
    if (!(await this.keepsFollows(delegation))) {
      throw new BadRequestException(NO_FOLLOW_LIST);
    }
    await this.syr.unfollow(delegation, did);
  }

  /**
   * One page of what an identity publishes on one instance. A DID names a
   * person and never a place, so the instance is asked and never derived;
   * absent, it is this one, which is the whole of it for somebody who keeps
   * their graph here.
   */
  async publications(query: PeerPublicationsQuery): Promise<PublishedIndex> {
    const origin = query.source_url ?? hereOrigin(this.config);
    const body = await readPeerJson(
      publicationsUrl(origin, query.did, query.cursor),
      peerReach(this.config),
    );
    if (body === null) return { did: query.did, publications: [] };
    try {
      return parsePublishedIndex(body, query.did);
    } catch (error) {
      if (error instanceof UnaskedAnswerError) {
        throw new ServiceUnavailableException(
          "Sloppy could not read what that instance publishes.",
        );
      }
      throw error;
    }
  }

  private async keepsFollows(delegation: Delegation): Promise<boolean> {
    return this.syr.keepsFollows(delegation.syr_instance_url, delegation.did);
  }
}
