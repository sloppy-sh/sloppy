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
 * What one address said when it was asked for a document.
 *
 * - `held` — something came back, and it is JSON.
 * - `none` — the instance says there is nothing at that address. **That is an
 *   answer**, and it is what lets a caller settle on nobody rather than on not
 *   knowing.
 * - `unreachable` — nothing answered. `refused` is this instance declining to
 *   connect at all, which is the deployment's answer and not the peer's.
 */
export type PeerAnswer =
  | { readonly answer: "held"; readonly body: unknown }
  | { readonly answer: "none" }
  | { readonly answer: "unreachable"; readonly refused: boolean };

/** How far an answer may run and how long it may take. Absent is what a page of
 *  a published branch is read under. */
export interface AnswerBounds {
  maxBytes?: number;
  timeoutMs?: number;
}

const unreachable = { answer: "unreachable", refused: false } as const;

/**
 * One JSON answer, for a caller that must tell "there is nothing there" apart
 * from "nothing answered" — {@link readPeerJson} is the shape for a caller
 * where either is a refusal in front of a person.
 *
 * A pull is an outbound fetch: nothing about the reader's own request bounds
 * what comes back, so the bytes are counted as they arrive and the read gives
 * up at {@link MAX_PUBLISHED_PAGE_BYTES} rather than at the parse — a count
 * needs a whole body first, and the answer that never ends is the threat.
 */
export async function askPeerJson(
  url: string,
  policy: HostPolicy,
  bounds: AnswerBounds = {},
): Promise<PeerAnswer> {
  let response: Awaited<ReturnType<typeof fetchReachable>>;
  try {
    response = await fetchReachable(url, policy, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(bounds.timeoutMs ?? REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof ForbiddenException) {
      logger.warn(`${url} is at an address this instance will not connect to`);
      return { answer: "unreachable", refused: true };
    }
    logger.warn(`${url} did not answer: ${reason(error)}`);
    return unreachable;
  }

  if (response.status === 404) {
    await discard(response);
    return { answer: "none" };
  }
  if (!response.ok) {
    await discard(response);
    logger.warn(`${url} answered ${response.status}`);
    return unreachable;
  }

  const body = await bounded(response, url, bounds.maxBytes);
  if (body === null) return unreachable;
  if (body.trim() === "") return { answer: "none" };
  try {
    return { answer: "held", body: JSON.parse(body) };
  } catch {
    logger.warn(`${url} answered something that is not JSON`);
    return unreachable;
  }
}

/**
 * One JSON answer from a peer's public endpoint, or `null` where the instance
 * says there is nothing at that address.
 *
 * What the far end SAID about a refusal is not passed on: the words in front of
 * a person come from Sloppy, and a peer's server is not one of the servers
 * AI.md § "User-Facing Copy" means by "where the server explains itself".
 */
export async function readPeerJson(
  url: string,
  policy: HostPolicy,
): Promise<unknown | null> {
  const said = await askPeerJson(url, policy);
  if (said.answer === "held") return said.body;
  if (said.answer === "none") return null;
  throw said.refused
    ? new BadRequestException(UNREACHABLE)
    : new ServiceUnavailableException(UNREACHABLE);
}

/**
 * One thing said to a peer's public endpoint, and whether it was taken. The
 * body of the answer is not read: a courtesy left at somebody else's instance
 * is either accepted or it is not, and nothing the far end says back changes
 * what the caller does next.
 *
 * Nothing here throws. A peer that is down, refuses, or sits at an address this
 * deployment will not connect to is a `false`, so a caller can leave one
 * without the person's own work turning on it.
 */
export async function tellPeerJson(
  url: string,
  body: unknown,
  policy: HostPolicy,
): Promise<boolean> {
  try {
    const response = await fetchReachable(url, policy, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok) {
      logger.warn(`${url} answered ${response.status}`);
      return false;
    }
    return true;
  } catch (error) {
    logger.warn(`${url} did not answer: ${reason(error)}`);
    return false;
  }
}

/** `null` where the answer ran past what is read, or stopped part way — an
 *  answer nobody has the whole of is not one. */
async function bounded(
  response: Awaited<ReturnType<typeof fetchReachable>>,
  url: string,
  maxBytes = MAX_PUBLISHED_PAGE_BYTES,
): Promise<string | null> {
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
      if (bytes > maxBytes) {
        logger.warn(`${url} was still answering past the size Sloppy reads`);
        return null;
      }
      held += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    logger.warn(`${url} stopped part way: ${reason(error)}`);
    return null;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return held + decoder.decode();
}

async function discard(
  response: Awaited<ReturnType<typeof fetchReachable>>,
): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
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
  return asked(publicationUrl(origin, publication), { version, cursor });
}

/** One publication's chain, newest version first. */
export function versionsUrl(
  origin: PeerOrigin,
  publication: OwnedRef,
  cursor?: string,
): string {
  return asked(`${publicationUrl(origin, publication)}/versions`, { cursor });
}

/** What one publication's writing did between two of its versions, in that
 *  order. */
export function changesUrl(
  origin: PeerOrigin,
  publication: OwnedRef,
  from: OwnedRef,
  to: OwnedRef,
  cursor?: string,
): string {
  return asked(`${publicationUrl(origin, publication)}/changes`, {
    from,
    to,
    cursor,
  });
}

function publicationUrl(origin: PeerOrigin, publication: OwnedRef): string {
  const { owner, localId } = splitOwnedRef(publication);
  return (
    `${origin}/api/public/publications/${encodeURIComponent(owner)}` +
    `/${encodeURIComponent(localId)}`
  );
}

function asked(at: string, query: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) search.set(key, value);
  }
  const written = search.toString();
  return written === "" ? at : `${at}?${written}`;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
