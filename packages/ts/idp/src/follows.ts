// Who a person follows, kept the way syr keeps it: a row owned by the follower,
// naming a DID and — where this instance could resolve one — the store that
// answers for it. Following a stranger is the whole point, so nothing here
// requires the followed identity to live on this instance.

import { DidSyrSchema, nowIso, type SyrFollow } from "@sloppy/types";
import { z } from "zod";
import type { IdpContext } from "./context.js";
import {
  createFollow,
  deleteFollow,
  findFollow,
  type FollowRow,
  listFollows,
  mergeFollow,
} from "./store.js";

export const FollowCreateSchema = z.object({
  followed_did: DidSyrSchema,
  provider_url: z.url().optional(),
});
export type FollowCreate = z.infer<typeof FollowCreateSchema>;

export function followView(row: FollowRow): SyrFollow {
  return {
    followed_did: row.followed_did,
    followed_provider_url: row.followed_provider_url,
  };
}

export async function following(
  ctx: IdpContext,
  did: string,
  page: { limit: number; offset: number },
): Promise<{ entries: SyrFollow[]; total: number }> {
  const { rows, total } = await listFollows(ctx.db, did, page);
  return { entries: rows.map(followView), total };
}

/** Following somebody already followed records where they answer now rather
 *  than a second row: one follow is one relationship, however often it is
 *  asked for. */
export async function addFollow(
  ctx: IdpContext,
  did: string,
  request: FollowCreate,
): Promise<SyrFollow> {
  const provider = request.provider_url ?? null;
  const standing = await findFollow(ctx.db, did, request.followed_did);
  if (standing) {
    return followView(
      provider === null
        ? standing
        : await mergeFollow(ctx.db, standing.id, {
            followed_provider_url: provider,
          }),
    );
  }
  return followView(
    await createFollow(ctx.db, {
      did,
      followed_did: request.followed_did,
      followed_provider_url: provider,
      created_at: nowIso(),
    }),
  );
}

/** A follow that is not there is the state being asked for, so this answers the
 *  same either way. */
export async function removeFollow(
  ctx: IdpContext,
  did: string,
  followedDid: string,
): Promise<void> {
  const row = await findFollow(ctx.db, did, followedDid);
  if (row) await deleteFollow(ctx.db, row.id);
}
