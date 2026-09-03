// Reading another instance's public endpoints. docs/ARCHITECTURE.md
// § "Federating the graph" is the doc of record.

import {
  BadRequestException,
  ForbiddenException,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  MAX_PUBLISHED_PAGE_BYTES,
  type OwnedRef,
  type PeerOrigin,
  PeerOriginSchema,
  splitOwnedRef,
} from "@sloppy/types";
import type { AppConfigService } from "../config/app-config.service";
import {
  type HostPolicy,
  fetchReachable,
  ownOrigin,
} from "../media/remote-host";

const REQUEST_TIMEOUT_MS = 15_000;

/** Said to somebody who typed the address, so it is about the instance they
 *  named. `remote-host.ts` refuses in words meant for a picture. */
const UNREACHABLE = "Sloppy could not reach that instance. Try again later.";

const logger = new Logger("PeerFetch");

/**
 * One JSON answer from a peer's public endpoint, or `null` where the instance
 * says there is nothing at that address.
 *
 * A pull is an outbound fetch: nothing about the reader's own request bounds
 * what comes back, so the bytes are counted as they arrive and the read gives
 * up at {@link MAX_PUBLISHED_PAGE_BYTES} rather than at the parse — a count
 * needs a whole body first, and the answer that never ends is the threat.
 *
 * What the far end SAID about a refusal is not passed on: the words in front of
 * a person come from Sloppy, and a peer's server is not one of the servers
 * AI.md § "User-Facing Copy" means by "where the server explains itself".
 */
export async function readPeerJson(
  url: string,
  policy: HostPolicy,
): Promise<unknown | null> {
  let response: Awaited<ReturnType<typeof fetchReachable>>;
  try {
    response = await fetchReachable(url, policy, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof ForbiddenException) {
      throw new BadRequestException(UNREACHABLE);
    }
    logger.warn(`${url} did not answer: ${reason(error)}`);
    throw new ServiceUnavailableException(UNREACHABLE);
  }

  if (response.status === 404) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    logger.warn(`${url} answered ${response.status}`);
    throw new ServiceUnavailableException(UNREACHABLE);
  }

  const body = await bounded(response, url);
  if (body.trim() === "") return null;
  try {
    return JSON.parse(body);
  } catch {
    logger.warn(`${url} answered something that is not JSON`);
    throw new ServiceUnavailableException(UNREACHABLE);
  }
}

async function bounded(
  response: Awaited<ReturnType<typeof fetchReachable>>,
  url: string,
): Promise<string> {
  const stream = response.body;
  if (!stream) return "";
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let held = "";
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_PUBLISHED_PAGE_BYTES) {
        logger.warn(`${url} was still answering past the size Sloppy reads`);
        throw new ServiceUnavailableException(UNREACHABLE);
      }
      held += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return held + decoder.decode();
}

/**
 * Which addresses this instance will connect to on somebody's say-so. The same
 * answer a picture is fetched under, because a second policy beside it would be
 * a second answer to one question — `media/remote-host.ts` is where it lives.
 */
export function peerReach(config: AppConfigService): HostPolicy {
  return {
    allowPrivate: !config.isProduction,
    ownOrigin: ownOrigin(config.publicUrl),
  };
}

/** This instance, for a caller who named no other — the whole of it for
 *  somebody whose graph is kept here. */
export function hereOrigin(config: AppConfigService): PeerOrigin {
  const mine = ownOrigin(config.publicUrl);
  const origin = mine === undefined ? null : PeerOriginSchema.safeParse(mine);
  if (!origin?.success) {
    throw new BadRequestException("Name the instance to read from.");
  }
  return origin.data;
}

/** Where a peer's published listing and subtrees answer, under the origin the
 *  reader named. Sloppy's own routes, not syr's — an identity manifest says
 *  nothing about where a graph is served. */
export function publicationsUrl(
  origin: PeerOrigin,
  did: string,
  cursor?: string,
): string {
  const at = `${origin}/api/public/publications/${encodeURIComponent(did)}`;
  return cursor === undefined
    ? at
    : `${at}?cursor=${encodeURIComponent(cursor)}`;
}

/** One version of one publication, page by page. An absent `version` asks for
 *  the newest, and the first page says which that was. */
export function subtreeUrl(
  origin: PeerOrigin,
  publication: OwnedRef,
  version?: OwnedRef,
  cursor?: string,
): string {
  const { did, localId } = splitOwnedRef(publication);
  const at =
    `${origin}/api/public/publications/${encodeURIComponent(did)}` +
    `/${encodeURIComponent(localId)}`;
  const query = new URLSearchParams();
  if (version !== undefined) query.set("version", version);
  if (cursor !== undefined) query.set("cursor", cursor);
  const search = query.toString();
  return search === "" ? at : `${at}?${search}`;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
