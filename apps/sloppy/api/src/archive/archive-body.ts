// The file on an import request. A device sends the archive as the body or as
// one part of a form, and both arrive here as the same bytes.

import { BadRequestException, PayloadTooLargeException } from "@nestjs/common";
import type { Request } from "express";

/** Where a form's parts are separated, as the request's own type states it. */
export function boundaryOf(contentType: string | undefined): string | null {
  if (!contentType?.toLowerCase().startsWith("multipart/")) return null;
  const said = /;\s*boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = (said?.[1] ?? said?.[2] ?? "").trim();
  return boundary === "" ? null : boundary;
}

/**
 * The first part of a form that carries a file, or the whole body where it is
 * not a form. A part with no filename is a field rather than the archive, so it
 * is stepped over.
 */
export function fileIn(body: Buffer, boundary: string): Uint8Array | null {
  const opens = `--${boundary}`;
  const gap = Buffer.from("\r\n\r\n");
  let at = body.indexOf(Buffer.from(opens));
  while (at !== -1) {
    const headersFrom = at + opens.length;
    if (body.subarray(headersFrom, headersFrom + 2).toString() === "--") {
      return null;
    }
    const bodyFrom = body.indexOf(gap, headersFrom);
    if (bodyFrom === -1) return null;
    const headers = body.subarray(headersFrom, bodyFrom).toString("latin1");
    const next = closingAt(body, boundary, bodyFrom);
    if (/;\s*filename\s*=/i.test(headers)) {
      return body.subarray(bodyFrom + gap.length, next ?? body.length);
    }
    if (next === null) return null;
    at = next + 2;
  }
  return null;
}

/**
 * Where the part that started at `from` ends: the next separator on a line of
 * its own. A run of those same bytes inside the file is not one, which is why
 * what follows it is checked rather than only what it is.
 */
function closingAt(
  body: Buffer,
  boundary: string,
  from: number,
): number | null {
  const delimiter = Buffer.from(`\r\n--${boundary}`);
  let at = body.indexOf(delimiter, from);
  while (at !== -1) {
    const after = body
      .subarray(at + delimiter.length, at + delimiter.length + 2)
      .toString("latin1");
    if (after === "\r\n" || after === "--" || after === "") return at;
    at = body.indexOf(delimiter, at + 1);
  }
  return null;
}

/**
 * The archive a request carries. `limit` is the most that will be held, and a
 * body past it is refused as it arrives rather than after it has all been read.
 */
export async function readArchive(
  req: Request,
  limit: number,
): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let held = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    held += chunk.byteLength;
    if (held > limit) {
      req.destroy();
      throw new PayloadTooLargeException(
        "That file is too big to bring in here.",
      );
    }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  const boundary = boundaryOf(req.headers["content-type"]);
  if (boundary === null) return body;
  const file = fileIn(body, boundary);
  if (file === null) {
    throw new BadRequestException(
      "Choose the graph file you want to bring in.",
    );
  }
  return file;
}
