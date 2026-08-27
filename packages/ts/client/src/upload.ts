// Sending a file, from a browser. The three steps `@sloppy/types`' `media.ts`
// describes, with the middle one going straight from the device to wherever the
// ticket points — the bytes never travel through Sloppy.

import type { CreateUploadRequest, MediaAsset, MediaRole } from "@sloppy/types";
import type { SloppyClient } from "./index.js";

export interface UploadHandle {
  readonly asset: Promise<MediaAsset>;
  /** Stops the send. The `asset` promise rejects. */
  cancel: () => void;
}

/** `0` to `1`. Reported only while the bytes are moving. */
export type UploadProgress = (fraction: number) => void;

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Absent where the browser has no `crypto.subtle` — an insecure origin. The
 *  store then takes the bytes without checking them, rather than refusing. */
async function digestOf(file: Blob): Promise<string | undefined> {
  try {
    return hex(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
  } catch {
    return undefined;
  }
}

async function measure(
  file: File,
): Promise<{ width?: number; height?: number }> {
  if (!file.type.startsWith("image/")) return {};
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    bitmap.close();
    return { width, height };
  } catch {
    return {};
  }
}

/**
 * `XMLHttpRequest` rather than `fetch`, for the one thing fetch cannot do:
 * report how far a body has got. A streaming request body would, and fails
 * CORS against most object stores.
 */
function put(
  url: string,
  headers: Record<string, string>,
  file: File,
  stop: AbortSignal,
  onProgress?: UploadProgress,
): Promise<void> {
  return new Promise((done, fail) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url, true);
    for (const [name, value] of Object.entries(headers)) {
      request.setRequestHeader(name, value);
    }
    request.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? done()
        : fail(new Error("That file could not be added. Try again."));
    request.onerror = () =>
      fail(new Error("That file could not be added. Try again."));
    request.onabort = () => fail(new Error("That file was not added."));
    stop.addEventListener("abort", () => request.abort(), { once: true });
    request.send(file);
  });
}

export function uploadFile(
  client: SloppyClient,
  file: File,
  options: { role: MediaRole; onProgress?: UploadProgress },
): UploadHandle {
  const stop = new AbortController();

  const asset = (async (): Promise<MediaAsset> => {
    // Before the ticket, so the store can be told what to expect and refuse
    // bytes that do not match.
    const sha256 = await digestOf(file);
    const request: CreateUploadRequest = {
      role: options.role,
      filename: file.name,
      mime_type: file.type || "application/octet-stream",
      size: file.size,
      ...(sha256 ? { sha256 } : {}),
    };
    const ticket = await client.createUpload(request);
    const measured = measure(file);
    await put(
      ticket.upload_url,
      ticket.upload_headers,
      file,
      stop.signal,
      options.onProgress,
    );
    return client.completeUpload({
      upload_id: ticket.upload_id,
      ...(await measured),
      ...(sha256 ? { sha256 } : {}),
    });
  })();

  return { asset, cancel: () => stop.abort() };
}
