// Following somebody, and reading what an instance serves about them: what they
// publish, one publication's chain, and what its writing did between two
// versions.
//
// All of it runs here rather than in the browser: a browser resolving a peer's
// provider, or asking their instance for a listing, tells that instance who is
// reading — which is the leak `proxied()` exists to prevent.

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  type FollowedIdentity,
  type PeerChangesQuery,
  type PeerPublicationsQuery,
  type PeerVersionsQuery,
  type PublishedChangesPage,
  type PublishedIndex,
  type PublishedVersionsPage,
  UnaskedAnswerError,
  parsePublishedIndex,
  publishedChangesReader,
  publishedVersionsReader,
} from "@sloppy/types";
import { AppConfigService } from "../config/app-config.service";
import type { Delegation } from "../syr/syr.service";
import { SyrService } from "../syr/syr.service";
import {
  changesUrl,
  hereOrigin,
  peerReach,
  publicationsUrl,
  readPeerJson,
  versionsUrl,
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
    return held(
      () => parsePublishedIndex(body, query.did),
      "Sloppy could not read what that instance publishes.",
    );
  }

  /** One page of a publication's chain, newest version first. An empty chain is
   *  also what a branch taken down leaves behind. */
  async versions(query: PeerVersionsQuery): Promise<PublishedVersionsPage> {
    const publication = query.publication;
    const origin = query.source_url ?? hereOrigin(this.config);
    const body = await readPeerJson(
      versionsUrl(origin, publication, query.cursor),
      peerReach(this.config),
    );
    if (body === null) return { publication, versions: [] };
    return held(
      () => publishedVersionsReader({ publication }).take(body),
      "Sloppy could not read that branch's history.",
    );
  }

  /**
   * One page of what a publication's writing did between two of its versions.
   * The instance holding them makes the comparison, so a reader sees what moved
   * without holding either side of it.
   *
   * Nothing at that address is refused rather than answered empty: an empty
   * difference says the writing did not move, and that is a different thing
   * from a branch that is no longer served.
   */
  async changes(query: PeerChangesQuery): Promise<PublishedChangesPage> {
    const { publication, from, to } = query;
    const origin = query.source_url ?? hereOrigin(this.config);
    const body = await readPeerJson(
      changesUrl(origin, publication, from, to, query.cursor),
      peerReach(this.config),
    );
    if (body === null) {
      throw new NotFoundException("Those versions are not published there.");
    }
    return held(
      () => publishedChangesReader({ publication, from, to }).take(body),
      "Sloppy could not read what changed there.",
    );
  }

  private async keepsFollows(delegation: Delegation): Promise<boolean> {
    return this.syr.keepsFollows(delegation.syr_instance_url, delegation.did);
  }
}

/** An answer held to the question that was asked. What the far end actually
 *  sent is `@sloppy/types`' business; a reader is told `saying` instead. */
function held<T>(read: () => T, saying: string): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof UnaskedAnswerError) {
      throw new ServiceUnavailableException(saying);
    }
    throw error;
  }
}
