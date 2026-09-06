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
/** How long a walk's answers stand. */
const REMEMBERED_MS = 5 * 60 * 1000;
/** How many authors are remembered at once, least recently walked first. */
const AUTHORS_REMEMBERED = 64;
/** And how many addresses across all of them, since how long one author's
 *  listing runs is their choice rather than this instance's. */
const ADDRESSES_REMEMBERED = 20_000;

/** Said for a picture the reader holds no branch of, and for one the author's
 *  store no longer keeps in the open. Which of the two it was is not something
 *  the reader can act on differently. */
const NOT_THERE = "That picture is not there.";

interface Walked {
  at: number;
  /** Every public picture the walk saw, by its local id. */
  addresses: Map<string, string>;
  /** The offset the walk stopped at, which is where the next one resumes. */
  next: number;
  /** Whether the walk reached the end of the listing, so a picture absent from
   *  {@link Walked.addresses} is one the store does not serve. */
  whole: boolean;
}

/**
 * A publication's pictures live in its author's own store, readable by
 * anybody — publishing is what put them there. This finds one and hands back
 * the address it reads from.
 */
@Injectable()
export class HeldPictures {
  private readonly walked = new Map<string, Walked>();
  private readonly walking = new Map<string, Promise<Walked>>();
  private remembered = 0;

  constructor(
    private readonly config: AppConfigService,
    private readonly pulls: PullRepository,
    private readonly syr: SyrService,
  ) {}

  /**
   * Where one picture inside a held note reads back from. The reader must hold
   * a region of that author's graph, and the instance to ask comes off that
   * region rather than off the request.
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

    const walked = await this.queued(
      at,
      region.source_url,
      author.data,
      picture.localId,
    );
    const found = walked.addresses.get(picture.localId);
    if (found === undefined) throw new NotFoundException(NOT_THERE);
    return found;
  }

  /**
   * One walk of an author's listing at a time: a note of twelve figures asks
   * for twelve pictures at once, and each of those waits for what the walk
   * ahead of it remembered before reading anything itself.
   */
  private async queued(
    at: string,
    instanceUrl: string,
    did: DidSyr,
    localId: string,
  ): Promise<Walked> {
    const ahead = this.walking.get(at);
    const mine = (async () => {
      if (ahead !== undefined) await ahead.catch(() => undefined);
      const known = this.fresh(at);
      if (known !== undefined && (known.whole || known.addresses.has(localId)))
        return known;
      const walked = await this.walk(
        instanceUrl,
        did,
        localId,
        known,
        peerReach(this.config),
      );
      this.remember(at, walked);
      return walked;
    })();

    this.walking.set(at, mine);
    try {
      return await mine;
    } finally {
      if (this.walking.get(at) === mine) this.walking.delete(at);
    }
  }

  /** The listing page by page from where the last walk of it stopped. A page
   *  shorter than the one asked for is not the end: how a peer's instance pages
   *  is its own business, so only an empty page says the listing is exhausted. */
  private async walk(
    instanceUrl: string,
    did: DidSyr,
    localId: string,
    from: Walked | undefined,
    reach: HostPolicy,
  ): Promise<Walked> {
    const addresses = new Map(from?.addresses);
    let offset = from?.next ?? 0;
    while (offset < READ_LIMIT) {
      const page = await this.syr.listPublicUploads(
        instanceUrl,
        did,
        { limit: PER_READ, offset },
        reach,
      );
      for (const row of page) {
        const readable = readableAddress(row);
        if (readable !== undefined) addresses.set(row.local_id, readable);
      }
      if (page.length === 0)
        return { at: Date.now(), addresses, next: offset, whole: true };
      offset += page.length;
      if (addresses.has(localId))
        return { at: Date.now(), addresses, next: offset, whole: false };
    }
    return { at: Date.now(), addresses, next: offset, whole: false };
  }

  private fresh(at: string): Walked | undefined {
    const held = this.walked.get(at);
    if (held === undefined) return undefined;
    if (Date.now() - held.at < REMEMBERED_MS) return held;
    this.forget(at, held);
    return undefined;
  }

  private remember(at: string, walked: Walked): void {
    const had = this.walked.get(at);
    if (had !== undefined) this.forget(at, had);
    this.walked.set(at, walked);
    this.remembered += walked.addresses.size;
    for (const [key, held] of this.walked) {
      if (
        this.walked.size <= AUTHORS_REMEMBERED &&
        this.remembered <= ADDRESSES_REMEMBERED
      )
        break;
      this.forget(key, held);
    }
  }

  private forget(at: string, held: Walked): void {
    this.walked.delete(at);
    this.remembered -= held.addresses.size;
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
