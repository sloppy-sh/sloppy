// The pictures a section names, on the way into a vault and back out of one.
// docs/ARCHITECTURE.md § "A graph on disk".

import { IMAGE_MIME_TYPES } from "../media/media.service";

/** `upload_id`, or anything ending `_upload_id` — the convention `citedUploads`
 *  reads a picture by, so an element kind this build has no renderer for
 *  travels with its pictures. */
const CITES_UPLOAD = /^(?:.*_)?upload_id$/;

/**
 * The same document with every upload it names replaced by what `named` calls
 * that upload. One this map says nothing about is left exactly as it was: a
 * picture whose bytes did not travel still reads as the picture it was.
 */
export function rewriteUploads<T>(
  content: T,
  named: ReadonlyMap<string, string>,
): T {
  if (named.size === 0) return content;
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value === null || typeof value !== "object") return value;
    const written: Record<string, unknown> = {};
    for (const [key, held] of Object.entries(value)) {
      written[key] =
        CITES_UPLOAD.test(key) && typeof held === "string"
          ? (named.get(held) ?? held)
          : walk(held);
    }
    return written;
  };
  return walk(content) as T;
}

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** What a picture's file is called after the dot. */
export function extensionFor(mimeType: string): string {
  return EXTENSIONS[mimeType] ?? "bin";
}

/** The type a vault's file name says its bytes are, or absent where this build
 *  would not have written that file. */
export function mimeForExtension(extension: string): string | undefined {
  const lowered = extension.toLowerCase();
  const found = Object.entries(EXTENSIONS).find(
    ([, suffix]) => suffix === (lowered === "jpeg" ? "jpg" : lowered),
  );
  return found?.[0];
}

export function isPictureMime(mimeType: string): boolean {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}
