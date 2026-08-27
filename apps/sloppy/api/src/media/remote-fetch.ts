// Reading a remote picture into memory, for the one case that is not a render:
// taking a copy of it. `asset.controller.ts` streams instead, because nothing
// there ever needs the whole file at once.

import {
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ownOrigin, reachableUrl } from "./remote-host";

const FETCH_TIMEOUT_MS = 10_000;

export interface RemotePicture {
  bytes: Uint8Array;
  mimeType: string;
}

/**
 * Fetched by this instance rather than by the device, so taking a copy of
 * somebody's emoji does not tell their instance who took it.
 *
 * Refuses anything past `maxBytes` on what actually arrives, not on what the
 * far end declared — a length header is somebody else's claim.
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
  const url = reachableUrl(target, {
    allowPrivate: policy.allowPrivate,
    ownOrigin: ownOrigin(policy.publicUrl),
  });

  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "follow",
      headers: { accept: "image/*" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new ServiceUnavailableException("That picture could not be loaded.");
  }
  if (!response.ok) {
    throw new BadRequestException("That picture could not be loaded.");
  }

  const mimeType = (response.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim();
  if (!policy.mimeTypes.includes(mimeType)) {
    throw new BadRequestException(
      "That file type cannot be used here. Try a PNG, JPEG, GIF or WebP.",
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > policy.maxBytes) {
    throw new BadRequestException("That picture is too big to copy.");
  }
  return { bytes, mimeType };
}
