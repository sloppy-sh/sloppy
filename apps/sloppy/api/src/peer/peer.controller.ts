import { Controller, Get, Query } from "@nestjs/common";
import {
  PeerPublicationsQuerySchema,
  type PublishedIndex,
} from "@sloppy/types";
import { parseBody } from "../node/request";
import { PeerService } from "./peer.service";

@Controller("peers")
export class PeerController {
  constructor(private readonly peers: PeerService) {}

  /**
   * What an identity publishes on an instance. The asking is done here, so the
   * instance asked learns this instance and never the reader.
   */
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
}
