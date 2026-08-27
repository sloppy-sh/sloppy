// Fetching a picture on a reader's behalf and streaming it back, for the two
// routes that do it: anybody's public asset, and the caller's own private one.

import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Response } from "express";
import {
  fetchReachable,
  type HostPolicy,
  type ReachableResponse,
} from "./remote-host";

const TIMEOUT_MS = 10_000;
const logger = new Logger("PictureRelay");

export interface RelayOptions {
  policy: HostPolicy;
  maxBytes: number;
  /** What the far end may answer with. Anything else is refused before a byte
   *  of it is written, so a signed link cannot launder a document. */
  mimeTypes: readonly string[];
  cacheControl: string;
  /** Presented to the far end, and nothing else is: no agent, no language, no
   *  cookie. The whole point is that it learns nothing about the reader. */
  headers?: Record<string, string>;
}

/**
 * The far host is reached by this instance, so it learns this instance's
 * address and never the reader's — AI.md § "Sloppy's Vocabulary Stays Out of
 * the Identity Store".
 */
export async function relayPicture(
  res: Response,
  target: string,
  options: RelayOptions,
): Promise<void> {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), TIMEOUT_MS);
  let upstream: ReachableResponse;
  try {
    upstream = await fetchReachable(target, options.policy, {
      signal: stop.signal,
      headers: { accept: "image/*", ...options.headers },
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof HttpException) throw err;
    logger.warn(
      `${target} did not answer: ${err instanceof Error ? err.message : err}`,
    );
    throw unavailable();
  }

  const abandon = async (refusal: HttpException): Promise<never> => {
    clearTimeout(timer);
    stop.abort();
    await upstream.body?.cancel().catch(() => undefined);
    throw refusal;
  };

  const mimeType = (upstream.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!upstream.ok || !upstream.body) await abandon(unavailable());
  if (!options.mimeTypes.includes(mimeType)) await abandon(unavailable());

  const declared = Number(upstream.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > options.maxBytes) {
    await abandon(
      new HttpException(
        "That picture is too big to show.",
        HttpStatus.PAYLOAD_TOO_LARGE,
      ),
    );
  }

  res.status(HttpStatus.OK);
  res.setHeader("content-type", mimeType);
  // Served from this origin, so a document type would run as this origin.
  res.setHeader("content-security-policy", "sandbox; default-src 'none'");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("cache-control", options.cacheControl);

  try {
    await pipeline(
      Readable.fromWeb(upstream.body as never),
      cappedAt(options.maxBytes),
      res,
    );
  } catch (err) {
    // The head is out by here, so there is no status left to say it with:
    // dropping the connection is what tells a reader the picture is not whole.
    res.destroy();
    if (!readerLeft(err)) {
      logger.warn(
        `${target} was cut short: ${err instanceof Error ? err.message : err}`,
      );
    }
  } finally {
    clearTimeout(timer);
    stop.abort();
  }
}

/** The declared length can be absent or a lie, so the cap is enforced on what
 *  actually arrives. */
function cappedAt(maxBytes: number) {
  return async function* (
    chunks: AsyncIterable<Buffer>,
  ): AsyncGenerator<Buffer> {
    let sent = 0;
    for await (const chunk of chunks) {
      sent += chunk.length;
      if (sent > maxBytes) throw new Error("more bytes than the cap allows");
      yield chunk;
    }
  };
}

/** Someone closing the tab mid-picture is how a reader stops one loading, and
 *  says nothing about the far end. */
function readerLeft(err: unknown): boolean {
  return (
    (err as NodeJS.ErrnoException | null)?.code === "ERR_STREAM_PREMATURE_CLOSE"
  );
}

function unavailable(): HttpException {
  return new HttpException(
    "That picture could not be loaded.",
    HttpStatus.BAD_GATEWAY,
  );
}
