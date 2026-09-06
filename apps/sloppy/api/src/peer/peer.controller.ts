import { Controller, Get, Query } from "@nestjs/common";
import {
  PeerChangesQuerySchema,
  type PeerIdentity,
  PeerIdentityQuerySchema,
  PeerPublicationsQuerySchema,
  PeerVersionsQuerySchema,
  type PublishedChangesPage,
  type PublishedIndex,
  type PublishedVersionsPage,
} from "@sloppy/types";
import { parseBody } from "../node/request";
import { PeerService } from "./peer.service";

/** What another instance serves about an identity, read on the reader's behalf.
 *  Every ask here is made by this instance, so the one asked learns this
 *  instance and never the reader. */
@Controller("peers")
export class PeerController {
  constructor(private readonly peers: PeerService) {}

  /** Whoever a name names, so somebody can be found by what they say out loud. */
  @Get("identity")
  identity(
    @Query("name") name?: string,
    @Query("source_url") sourceUrl?: string,
  ): Promise<PeerIdentity> {
    return this.peers.identify(
      parseBody(PeerIdentityQuerySchema, { name, source_url: sourceUrl }),
    );
  }

  /** What an identity publishes on an instance. */
  @Get("publications")
  publications(
    @Query("did") did?: string,
    @Query("source_url") sourceUrl?: string,
    @Query("cursor") cursor?: string,
  ): Promise<PublishedIndex> {
    return this.peers.publications(
      parseBody(PeerPublicationsQuerySchema, {
        did,
        source_url: sourceUrl,
        cursor,
      }),
    );
  }

  /** One publication's chain, newest version first. */
  @Get("versions")
  versions(
    @Query("publication") publication?: string,
    @Query("source_url") sourceUrl?: string,
    @Query("cursor") cursor?: string,
  ): Promise<PublishedVersionsPage> {
    return this.peers.versions(
      parseBody(PeerVersionsQuerySchema, {
        publication,
        source_url: sourceUrl,
        cursor,
      }),
    );
  }

  /** What one publication's writing did between two of its versions. */
  @Get("changes")
  changes(
    @Query("publication") publication?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("source_url") sourceUrl?: string,
    @Query("cursor") cursor?: string,
  ): Promise<PublishedChangesPage> {
    return this.peers.changes(
      parseBody(PeerChangesQuerySchema, {
        publication,
        from,
        to,
        source_url: sourceUrl,
        cursor,
      }),
    );
  }
}
