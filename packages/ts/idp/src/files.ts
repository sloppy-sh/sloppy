// A person's own file store: the folders they keep and the blobs inside them.
//
// syr's `/api/folders` and `/api/uploads` are the contract, and an app that
// speaks one speaks the other — that is the whole reason the embedded provider
// carries a file store at all. The three steps are syr's: ask for a ticket, PUT
// the bytes where it points, then say they are there.
//
// Nothing here touches the bytes. The row says where they belong; the object
// store the API hands this package is what actually holds them.

import { nowIso, ulid } from "@sloppy/types";
import { z } from "zod";
import type { IdpContext } from "./context.js";
import { IdpError } from "./errors.js";
import {
  createFolder,
  createUpload,
  findFolder,
  findFolderById,
  findUpload,
  type FolderRow,
  listFolders,
  listPublicUploads,
  updateUpload,
  type UploadRow,
} from "./store.js";
import { issueToken, readToken, subjectOf } from "./tokens.js";

/** Root, as the folder rows spell it. syr sends `null`; the index needs a
 *  value, and every caller here goes through `folderKey`. */
const ROOT = "";

const TICKET_KIND = "upload";
/** As long as syr's presigned PUT stands, and for the same reason: somebody on
 *  a slow connection must be able to finish sending. */
export const UPLOAD_TICKET_TTL_SECONDS = 60 * 60;

/** Anything under a folder named `public` is readable by a stranger. It is the
 *  one rule that decides whether a peer can pull a note's pictures. */
const PUBLIC_ROOT = "public";

/** The largest file this store will hold. Without it a declared size is a
 *  caller choosing how much of this process to reserve. */
export const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

export const FolderCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the folder a name.")
    .max(64, "That folder name is too long.")
    .regex(/^[^/\\]+$/, "A folder name cannot contain a slash."),
  parent_id: z.string().nullable().optional(),
});
export type FolderCreate = z.infer<typeof FolderCreateSchema>;

export const UploadCreateSchema = z.object({
  filename: z.string().min(1).max(255),
  mime_type: z.string().min(1).max(255),
  size: z.int().positive().max(MAX_UPLOAD_BYTES, "That file is too big."),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
  folder_id: z.string().nullable().optional(),
  metadata: z
    .object({
      width: z.int().positive().optional(),
      height: z.int().positive().optional(),
    })
    .optional(),
});
export type UploadCreate = z.infer<typeof UploadCreateSchema>;

export const UploadCompleteSchema = z.object({
  did: z.string().min(1),
  local_id: z.string().min(1),
  status: z.literal("completed"),
});
export type UploadComplete = z.infer<typeof UploadCompleteSchema>;

export interface UploadTicket {
  signedUrl: string;
  finalUrl: string;
  uploadDid: string;
  uploadLocalId: string;
  isPublic: boolean;
}

export interface FolderView {
  id: string;
  name: string;
}

function folderKey(parentId: string | null | undefined): string {
  return parentId?.trim() || ROOT;
}

function folderView(row: FolderRow): FolderView {
  return { id: String(row.id.id), name: row.name };
}

export async function foldersUnder(
  ctx: IdpContext,
  did: string,
  parentId: string | null | undefined,
): Promise<FolderView[]> {
  const rows = await listFolders(ctx.db, did, folderKey(parentId));
  return rows.map(folderView);
}

export async function makeFolder(
  ctx: IdpContext,
  did: string,
  request: FolderCreate,
): Promise<FolderView> {
  const parent = folderKey(request.parent_id);
  if (parent !== ROOT) await ownFolder(ctx, did, parent);

  const held = await findFolder(ctx.db, did, parent, request.name);
  if (held) return folderView(held);
  try {
    return folderView(
      await createFolder(ctx.db, {
        did,
        name: request.name,
        parent_id: parent,
        created_at: nowIso(),
      }),
    );
  } catch (error) {
    // The unique index settles a race between two callers asking for the same
    // folder, and both of them wanted the folder rather than to be first.
    const raced = await findFolder(ctx.db, did, parent, request.name);
    if (raced) return folderView(raced);
    throw error;
  }
}

/** Every ancestor's name, outermost first. A folder whose chain is broken or
 *  belongs to somebody else refuses here rather than resolving to a path. */
async function pathOf(
  ctx: IdpContext,
  did: string,
  folderId: string,
): Promise<string[]> {
  const names: string[] = [];
  let at: string = folderId;
  // A cycle cannot be written through `makeFolder`, but a bound is what stops
  // a hand-edited row from hanging the request that reads it.
  for (let depth = 0; depth < 32 && at !== ROOT; depth++) {
    const row = await ownFolder(ctx, did, at);
    names.unshift(row.name);
    at = row.parent_id;
  }
  return names;
}

async function ownFolder(
  ctx: IdpContext,
  did: string,
  folderId: string,
): Promise<FolderRow> {
  const row = await findFolderById(ctx.db, folderId);
  if (!row || row.did !== did) {
    throw new IdpError(404, "not_found", "That folder is not there.");
  }
  return row;
}

/**
 * Step one of three. The row and its place in the object store are settled
 * here, so the bytes have somewhere to land before anybody starts sending.
 */
export async function openUpload(
  ctx: IdpContext,
  did: string,
  request: UploadCreate,
): Promise<UploadTicket> {
  const folderId = folderKey(request.folder_id);
  const path = folderId === ROOT ? [] : await pathOf(ctx, did, folderId);
  const localId = ulid();
  const key = ["uploads", did, ...path, localId].join("/");
  const isPublic = path[0] === PUBLIC_ROOT;

  await createUpload(
    ctx.db,
    {
      did,
      filename: request.filename,
      mime_type: request.mime_type,
      size: request.size,
      ...(request.sha256 ? { sha256: request.sha256.toLowerCase() } : {}),
      folder_id: folderId,
      key,
      url: blobUrl(ctx, did, localId),
      is_public: isPublic,
      status: "pending",
      ...(request.metadata && Object.keys(request.metadata).length
        ? { metadata: request.metadata }
        : {}),
      created_at: nowIso(),
    },
    localId,
  );

  return {
    signedUrl: `${blobUrl(ctx, did, localId)}?ticket=${issueUploadTicket(ctx, did, localId)}`,
    finalUrl: blobUrl(ctx, did, localId),
    uploadDid: did,
    uploadLocalId: localId,
    isPublic,
  };
}

/**
 * Step three. `null` while the bytes have not arrived — the caller asks again,
 * because "not yet" and "never" are different answers and only one of them is
 * worth telling somebody about.
 */
export async function finishUpload(
  ctx: IdpContext,
  did: string,
  localId: string,
): Promise<UploadRow | null> {
  const row = await requireUpload(ctx, did, localId);
  return row.status === "completed" ? row : null;
}

export async function requireUpload(
  ctx: IdpContext,
  did: string,
  localId: string,
): Promise<UploadRow> {
  const row = await findUpload(ctx.db, localId);
  if (!row || row.did !== did) {
    throw new IdpError(404, "not_found", "That file is not there.");
  }
  return row;
}

export interface StoredBytes {
  size: number;
  sha256: string;
}

/**
 * The bytes arrived. What the row promised is checked against what turned up:
 * a size or a digest that does not match is a different file, and the store
 * says so rather than serving it.
 */
export async function acceptUpload(
  ctx: IdpContext,
  row: UploadRow,
  stored: StoredBytes,
): Promise<UploadRow> {
  if (
    stored.size !== row.size ||
    (row.sha256 && row.sha256 !== stored.sha256)
  ) {
    throw new IdpError(
      400,
      "file_verification_failed",
      "That file did not arrive as it was sent. Try adding it again.",
    );
  }
  return updateUpload(ctx.db, row.id, { status: "completed" });
}

export async function publicUploadsOf(
  ctx: IdpContext,
  did: string,
  page: { limit: number; offset: number },
): Promise<{ rows: UploadRow[]; total: number }> {
  return listPublicUploads(ctx.db, did, page);
}

/** Where the bytes read back from, for this instance's life. A ticket expires;
 *  this does not. */
export function blobUrl(ctx: IdpContext, did: string, localId: string): string {
  return `${blobBase(ctx, did)}${encodeURIComponent(localId)}`;
}

/** The upload one of this instance's own blob URLs names, or null for any
 *  other address — including one belonging to a different identity here. */
export function blobIdIn(
  ctx: IdpContext,
  did: string,
  url: string,
): string | null {
  const base = blobBase(ctx, did);
  return url.startsWith(base)
    ? decodeURIComponent(url.slice(base.length))
    : null;
}

function blobBase(ctx: IdpContext, did: string): string {
  return `${ctx.publicUrl}/api/idp/blob/${encodeURIComponent(did)}/`;
}

function issueUploadTicket(
  ctx: IdpContext,
  did: string,
  localId: string,
): string {
  return issueToken(
    { userId: did, sessionId: `${TICKET_KIND}:${localId}` },
    ctx.secrets.uploadTicket,
    UPLOAD_TICKET_TTL_SECONDS,
  );
}

/** The upload a ticket names, or null for one that does not check out — a
 *  forged ticket, an expired one, or one issued for a different upload. */
export function readUploadTicket(
  ctx: IdpContext,
  ticket: string,
): { did: string; localId: string } | null {
  const claims = readToken(ticket, ctx.secrets.uploadTicket);
  if (!claims) return null;
  const localId = subjectOf(claims.sessionId, TICKET_KIND);
  return localId ? { did: claims.userId, localId } : null;
}
