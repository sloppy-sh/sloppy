// How this provider paginates and how it serialises an upload, in the one place
// both the owner's routes and a stranger's read them from.

import type { PublicListing, UploadRow } from "@sloppy/idp";

// syr's own bounds on a public listing, so the same request against a real
// instance and against this one is answered the same way.
const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 100;

export interface Page {
  limit: number;
  offset: number;
}

export function pageOf(limit?: string, offset?: string): Page {
  const asked = Number.parseInt(limit ?? "", 10);
  return {
    limit: Number.isNaN(asked)
      ? DEFAULT_PAGE_SIZE
      : Math.min(MAX_PAGE_SIZE, Math.max(1, asked)),
    offset: Math.max(0, Number.parseInt(offset ?? "", 10) || 0),
  };
}

export function listing<T>(
  data: T[],
  page: Page,
  total: number,
): PublicListing<T> {
  return {
    status: "success",
    data,
    pagination: {
      ...page,
      total,
      has_more: page.offset + data.length < total,
    },
  };
}

export interface UploadView {
  did: string;
  local_id: string;
  filename: string;
  mime_type: string;
  size: number;
  status: string;
  /** Null until the bytes have landed. */
  url: string | null;
  metadata?: { width?: number; height?: number };
}

/** An upload as somebody other than the store sees one: where it reads back
 *  from, never where it sits. */
export function uploadView(row: UploadRow): UploadView {
  return {
    did: row.did,
    local_id: String(row.id.id),
    filename: row.filename,
    mime_type: row.mime_type,
    size: row.size,
    status: row.status,
    url: row.status === "completed" ? row.url : null,
    ...(row.metadata ? { metadata: row.metadata } : {}),
  };
}
