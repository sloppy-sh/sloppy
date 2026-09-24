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
  DidSyrSchema,
  type FollowedIdentity,
  type OwnedRef,
  type PeerChangesQuery,
  type PeerIdentity,
  type PeerIdentityQuery,
  type PeerOrigin,
  type PeerPublicationsQuery,
  type PeerVersionsQuery,
  type Principal,
  type PublishedChangesPage,
  type PublishedIndex,
  type PublishedVersionsPage,
  UnaskedAnswerError,
  parsePublishedIndex,
  peerOrigin,
  publishedChangesReader,
  publishedVersionsReader,
  splitOwnedRef,
} from "@sloppy/types";
import { AppConfigService } from "../config/app-config.service";
import type { HostPolicy } from "../media/remote-host";
import type { Delegation } from "../syr/syr.service";
import { SyrService } from "../syr/syr.service";
import {
  changesUrl,
  peerReach,
  publicationsUrl,
  readPeerJson,
  versionsUrl,
} from "./peer-fetch";
import { WhereaboutsService } from "./whereabouts.service";

/** Said where somebody's own store keeps no list of who they follow. Reading a
 *  stranger's branches never needed the list, so the line says what is left. */
const NO_FOLLOW_LIST =
  "This account cannot keep a list of who you follow. You can still look somebody up by their name or identifier and read what they publish.";

/** Said where the list a store keeps has nowhere to write somebody down: syr's
 *  follow record names a DID, so an identifier in any other scheme is not a
 *  refusal that trying again fixes. */
const NOT_IN_FOLLOW_LIST =
  "Your follow list cannot hold somebody named by an email address. You can still read what they publish, and pull a branch of theirs.";

/** Said where the instance holding the name answered about it with nobody. */
const NO_SUCH_NAME =
  "Nobody there goes by that name. Check the name, and the instance it is kept on.";

/** Said where nothing at that address looks names up at all, so no name would
 *  have been found there whatever it was. */
const NO_NAMES_THERE =
  "Sloppy could not look a name up there. Check the instance it is kept on, or use the identifier they gave you.";

@Injectable()
export class PeerService {
  constructor(
    private readonly config: AppConfigService,
    private readonly syr: SyrService,
    private readonly whereabouts: WhereaboutsService,
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
    if (!DidSyrSchema.safeParse(did).success) {
      throw new BadRequestException(NOT_IN_FOLLOW_LIST);
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

  /** One page of what an identity publishes, read wherever {@link where} says
   *  their graph is served. */
  async publications(query: PeerPublicationsQuery): Promise<PublishedIndex> {
    const origin = await this.whereabouts.instanceFor(
      query.did,
      query.source_url,
    );
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
    const origin = await this.whereabouts.instanceFor(
      authorOf(publication),
      query.source_url,
    );
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
    const origin = await this.whereabouts.instanceFor(
      authorOf(publication),
      query.source_url,
    );
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

  /**
   * Whoever a name names, asked of the instance named or, absent one, of the
   * store the reader's own name is kept on — which is where a name somebody was
   * given in person usually lives.
   */
  async identify(
    query: PeerIdentityQuery,
    delegation: Delegation,
  ): Promise<PeerIdentity> {
    const origin = query.source_url ?? nameHome(delegation);
    const reach = peerReach(this.config);
    if (!(await this.looksNamesUp(origin, reach))) {
      throw new NotFoundException(NO_NAMES_THERE);
    }
    const found = await this.syr.profileByName(
      origin,
      query.name.trim(),
      reach,
    );
    if (!found?.did) throw new NotFoundException(NO_SUCH_NAME);
    return { did: found.did };
  }

  /** Whether that address looks names up at all. Nothing there, and nothing
   *  there Sloppy can read, are both a no; an instance having a bad day is not,
   *  because coming back later is worth saying. */
  private async looksNamesUp(
    origin: PeerOrigin,
    reach: HostPolicy,
  ): Promise<boolean> {
    try {
      return await this.syr.keepsNames(origin, reach);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      return false;
    }
  }

  private async keepsFollows(delegation: Delegation): Promise<boolean> {
    return this.syr.keepsFollows(delegation.syr_instance_url, delegation.did);
  }
}

function authorOf(publication: OwnedRef): Principal {
  return splitOwnedRef(publication).owner;
}

/** Where the reader's own name is kept, which is the instance a lookup that
 *  named none is made on. */
function nameHome(delegation: Delegation): PeerOrigin {
  const origin = peerOrigin(delegation.syr_instance_url);
  if (origin === null) {
    throw new BadRequestException("Name the instance to look on.");
  }
  return origin;
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
