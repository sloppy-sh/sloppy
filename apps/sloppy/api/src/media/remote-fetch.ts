// Reading a remote picture into memory, for the one case that is not a render:
// taking a copy of it. `proxy.controller.ts` streams instead, because nothing
// there ever needs the whole file at once.

import {
  BadRequestException,
  HttpException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { fetchReachable, ownOrigin } from "./remote-host";

const FETCH_TIMEOUT_MS = 10_000;

export interface RemotePicture {
  bytes: Uint8Array;
  mimeType: string;
}

/**
 * Fetched by this instance rather than by the device, so taking a copy of
 * somebody's emoji does not tell their instance who took it.
 *
 * The far end chose this address and it chooses how much it sends, so the cap
 * is enforced as the bytes arrive: a length header is somebody else's claim,
 * and a body with no header at all must not be able to name this process's
 * memory ceiling.
 */
export async function readRemotePicture(
  target: string,
  policy: {
    allowPrivate: boolean;
    publicUrl: string;
    maxBytes: number;
    mimeTypes: readonly string[];
  },
): Promise<RemotePicture> {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await read(target, policy, stop.signal);
    const mimeType = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim();
    if (!policy.mimeTypes.includes(mimeType)) {
      throw new BadRequestException(
        "That file type cannot be used here. Try a PNG, JPEG, GIF or WebP.",
      );
    }
    if (Number(response.headers.get("content-length")) > policy.maxBytes) {
      throw tooBig();
    }
    return { bytes: await collect(response, policy.maxBytes, stop), mimeType };
  } finally {
    clearTimeout(timer);
    stop.abort();
  }
}

async function read(
  target: string,
  policy: { allowPrivate: boolean; publicUrl: string },
  signal: AbortSignal,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetchReachable(
      target,
      {
        allowPrivate: policy.allowPrivate,
        ownOrigin: ownOrigin(policy.publicUrl),
      },
      { headers: { accept: "image/*" }, signal },
    );
  } catch (error) {
    // A refused address is already an answer for a person; anything else here
    // is the far end failing to answer at all.
    if (error instanceof HttpException) throw error;
    throw new ServiceUnavailableException("That picture could not be loaded.");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new BadRequestException("That picture could not be loaded.");
  }
  return response;
}

async function collect(
  response: Response,
  maxBytes: number,
  stop: AbortController,
): Promise<Uint8Array> {
  if (!response.body) {
    throw new BadRequestException("That picture could not be loaded.");
  }
  const chunks: Uint8Array[] = [];
  let held = 0;
  for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
    held += chunk.byteLength;
    if (held > maxBytes) {
      stop.abort();
      throw tooBig();
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function tooBig(): BadRequestException {
  return new BadRequestException("That picture is too big to copy.");
}
