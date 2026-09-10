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

/** Each part of a form, as its headers and its bytes. */
function* partsIn(
  body: Buffer,
  boundary: string,
): Generator<{ headers: string; value: Buffer }> {
  const opens = `--${boundary}`;
  const gap = Buffer.from("\r\n\r\n");
  let at = body.indexOf(Buffer.from(opens));
  while (at !== -1) {
    const headersFrom = at + opens.length;
    if (body.subarray(headersFrom, headersFrom + 2).toString() === "--") return;
    const bodyFrom = body.indexOf(gap, headersFrom);
    if (bodyFrom === -1) return;
    const next = closingAt(body, boundary, bodyFrom);
    yield {
      headers: body.subarray(headersFrom, bodyFrom).toString("latin1"),
      value: body.subarray(bodyFrom + gap.length, next ?? body.length),
    };
    if (next === null) return;
    at = next + 2;
  }
}

const CARRIES_A_FILE = /;\s*filename\s*=/i;

/**
 * The first part of a form that carries a file, or the whole body where it is
 * not a form. A part with no filename is a field rather than the archive, so it
 * is stepped over.
 */
export function fileIn(body: Buffer, boundary: string): Uint8Array | null {
  for (const part of partsIn(body, boundary)) {
    if (CARRIES_A_FILE.test(part.headers)) return part.value;
  }
  return null;
}

/** A part's `name` parameter, whole: `settle_later` is not `settle`. */
function named(name: string): RegExp {
  const literal = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `;\\s*name\\s*=\\s*(?:"${literal}"|${literal}(?=[;\\s]|$))`,
    "i",
  );
}

/**
 * The value of a form field, or `null` where the form carries none by that
 * name. A part with a filename is the archive rather than a field.
 */
export function fieldIn(
  body: Buffer,
  boundary: string,
  name: string,
): string | null {
  for (const part of partsIn(body, boundary)) {
    if (CARRIES_A_FILE.test(part.headers)) continue;
    if (named(name).test(part.headers)) return part.value.toString("utf8");
  }
  return null;
}

/**
 * The archive a request carries, and how the person settled what the two copies
 * of the graph disagreed about — docs/ARCHITECTURE.md § "A graph on disk". A
 * body that is not a form is the archive and nothing else. `limit` is the most
 * that will be held, and a body past it is refused as it arrives rather than
 * after it has all been read.
 */
export async function readImport(
  req: Request,
  limit: number,
): Promise<{ archive: Uint8Array; settle: string | null }> {
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
  if (boundary === null) return { archive: body, settle: null };
  const file = fileIn(body, boundary);
  if (file === null) {
    throw new BadRequestException(
      "Choose the graph file you want to bring in.",
    );
  }
  return { archive: file, settle: fieldIn(body, boundary, "settle") };
}
