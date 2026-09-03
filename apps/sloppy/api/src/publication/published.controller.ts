import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
} from "@nestjs/common";
import {
  type DidSyr,
  type OwnedRef,
  OwnedRefSchema,
  type PublishedChangesPage,
  type PublishedIndex,
  type PublishedSubtreePage,
  type PublishedVersionsPage,
} from "@sloppy/types";
import { Public } from "../auth/public.decorator";
import { didOrRefuse, refOrNull } from "../node/request";
import { PublishedService } from "./published.service";

/**
 * The four routes a peer's instance calls, and the only ones here that answer
 * without a session. What they carry is what the author published and nothing
 * beside it. docs/ARCHITECTURE.md § "Federating the graph".
 */
@Controller("public/publications")
@Public()
export class PublishedController {
  constructor(private readonly published: PublishedService) {}

  @Get(":did")
  index(
    @Param("did") did: string,
    @Query("cursor") cursor?: string,
  ): Promise<PublishedIndex> {
    return this.published.index(didOrRefuse(did), cursor);
  }

  /** A page of one version; absent, the newest. `null` where nothing is
   *  published there. */
  @Get(":did/:localId")
  async subtree(
    @Param("did") did: string,
    @Param("localId") localId: string,
    @Query("version") version?: string,
    @Query("cursor") cursor?: string,
  ): Promise<PublishedSubtreePage | null> {
    const asked = named(version);
    if (version !== undefined && asked === undefined) return null;
    const at = this.at(did, localId);
    return at === null
      ? null
      : this.published.subtree(at.did, at.ref, asked, cursor);
  }

  @Get(":did/:localId/versions")
  async versions(
    @Param("did") did: string,
    @Param("localId") localId: string,
    @Query("cursor") cursor?: string,
  ): Promise<PublishedVersionsPage | null> {
    const at = this.at(did, localId);
    return at === null ? null : this.published.versions(at.did, at.ref, cursor);
  }

  @Get(":did/:localId/changes")
  async changes(
    @Param("did") did: string,
    @Param("localId") localId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("cursor") cursor?: string,
  ): Promise<PublishedChangesPage | null> {
    const earlier = named(from);
    const later = named(to);
    if (earlier === undefined || later === undefined) {
      throw new BadRequestException("Name the two versions to compare.");
    }
    const at = this.at(did, localId);
    return at === null
      ? null
      : this.published.changes(at.did, at.ref, earlier, later, cursor);
  }

  private at(
    did: string,
    localId: string,
  ): { did: DidSyr; ref: OwnedRef } | null {
    const ref = refOrNull(did, localId);
    return ref === null ? null : { did: didOrRefuse(did), ref };
  }
}

function named(raw: string | undefined): OwnedRef | undefined {
  if (raw === undefined || raw === "") return undefined;
  const ref = OwnedRefSchema.safeParse(raw);
  return ref.success ? ref.data : undefined;
}
