// Where a picture inside a note the reader PULLED reads back from.
// docs/ARCHITECTURE.md § "Pictures" is the doc of record.

import { Injectable, NotFoundException } from "@nestjs/common";
import { type DidSyr, DidSyrSchema, type SyrOwnedUpload } from "@sloppy/types";
import { AppConfigService } from "../config/app-config.service";
import { peerReach } from "../peer/peer-fetch";
import { PullRepository } from "../peer/pull.repository";
import { SyrService } from "../syr/syr.service";
import { roleLimits } from "./media.service";
import type { HostPolicy } from "./remote-host";

/** syr's own ceiling on a public listing. */
const PER_READ = 100;
/** Where the walk stops asking an instance that answers the same page whatever
 *  offset it is given. */
const READ_LIMIT = 10_000;
/** How long a walk's answers stand. One walk answers for every picture in the
 *  branch rather than only the one that was asked for, which is what puts a
 *  listing searched page by page behind an `<img>`. */
const REMEMBERED_MS = 5 * 60 * 1000;
/** How many authors are remembered at once, least recently walked first. */
const AUTHORS_REMEMBERED = 64;

/** Said for a picture the reader holds no branch of, and for one the author's
 *  store no longer keeps in the open. Which of the two it was is not something
 *  the reader can act on differently. */
const NOT_THERE = "That picture is not there.";

interface Walked {
  at: number;
  /** Every public picture the walk saw, by its local id. */
  addresses: Map<string, string>;
  /** Whether the walk reached the end of the listing, so a picture absent from
   *  {@link Walked.addresses} is one the store does not serve. */
  whole: boolean;
}

/**
 * A publication's pictures live in its author's own store, readable by
 * anybody — publishing is what put them there. This finds one and hands back
 * the address it reads from; the fetch itself is the relay's, so the author's
 * instance learns this one and never the reader.
 */
@Injectable()
export class HeldPictures {
  private readonly walked = new Map<string, Walked>();

  constructor(
    private readonly config: AppConfigService,
    private readonly pulls: PullRepository,
    private readonly syr: SyrService,
  ) {}

  /**
   * Where one picture inside a held note reads back from. The reader must hold
   * a region of that author's graph: the author is named by the picture and the
   * instance to ask comes off the region, so nothing a caller sends can aim
   * this instance anywhere it was not already reading.
   */
  async address(
    reader: DidSyr,
    picture: { did: string; localId: string },
  ): Promise<string> {
    const author = DidSyrSchema.safeParse(picture.did);
    if (!author.success) throw new NotFoundException(NOT_THERE);
    const region = await this.pulls.regionFrom(reader, author.data);
    if (region === null) throw new NotFoundException(NOT_THERE);

    const at = `${region.source_url}|${author.data}`;
    const known = this.fresh(at);
    const held = known?.addresses.get(picture.localId);
    if (held !== undefined) return held;
    if (known?.whole) throw new NotFoundException(NOT_THERE);

    const walked = await this.walk(
      region.source_url,
      author.data,
      picture.localId,
      peerReach(this.config),
    );
    this.remember(at, walked);
    const found = walked.addresses.get(picture.localId);
    if (found === undefined) throw new NotFoundException(NOT_THERE);
    return found;
  }

  /** The listing page by page, stopping at the picture that was asked for —
   *  everything seen on the way is remembered, so the rest of the note's
   *  pictures cost nothing. */
  private async walk(
    instanceUrl: string,
    did: DidSyr,
    localId: string,
    reach: HostPolicy,
  ): Promise<Walked> {
    const addresses = new Map<string, string>();
    let offset = 0;
    while (offset < READ_LIMIT) {
      const page = await this.syr.listPublicUploads(
        instanceUrl,
        did,
        { limit: PER_READ, offset },
        reach,
      );
      for (const row of page) {
        const from = readableAddress(row);
        if (from !== undefined) addresses.set(row.local_id, from);
      }
      if (addresses.has(localId))
        return { at: Date.now(), addresses, whole: false };
      if (page.length < PER_READ) {
        return { at: Date.now(), addresses, whole: true };
      }
      offset += page.length;
    }
    return { at: Date.now(), addresses, whole: false };
  }

  private fresh(at: string): Walked | undefined {
    const held = this.walked.get(at);
    if (held === undefined) return undefined;
    if (Date.now() - held.at < REMEMBERED_MS) return held;
    this.walked.delete(at);
    return undefined;
  }

  private remember(at: string, walked: Walked): void {
    this.walked.delete(at);
    this.walked.set(at, walked);
    for (const key of this.walked.keys()) {
      if (this.walked.size <= AUTHORS_REMEMBERED) break;
      this.walked.delete(key);
    }
  }
}

/** A row this instance is willing to draw from, or `undefined`. A store that
 *  says a blob is private is believed; one that says nothing about it is not
 *  contradicted. */
function readableAddress(row: SyrOwnedUpload): string | undefined {
  if (row.is_public === false) return undefined;
  if ((row.status ?? "completed") !== "completed") return undefined;
  if (!roleLimits("block").mimeTypes.includes(row.mime_type)) return undefined;
  return row.downloadUrl ?? row.url ?? undefined;
}
