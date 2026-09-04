// Publishing a subtree: the rows behind what a peer reads.
//
// A publication is a SNAPSHOT and not a window. Publishing copies the notes,
// their sections and every asset those sections cite into a version of its own,
// and publishing again writes another version beside it — so nothing the author
// does to a note, a picture or an emoji afterwards changes or breaks what a peer
// is already reading. `published.ts` is the shape those copies cross the wire
// in; docs/ARCHITECTURE.md § "Federating the graph" is the doc of record.

import { z } from "zod";
import { AddressSchema } from "./address.js";
import { splitOwnedRef } from "./codecs.js";
import { OwnedEntitySchema, OwnedRefSchema } from "./common.js";
import { BlockDocumentSchema } from "./document.js";
import {
  CommentAccessSchema,
  DEFAULT_COMMENT_ACCESS,
  PublishedNodeSchema,
  PublishedVersionSchema,
} from "./published.js";
import { TagsSchema } from "./tag.js";

/**
 * A subtree its author has made readable, and the chain of versions they have
 * published of it. Deleting this row takes every version with it, and what a
 * peer who already pulled one keeps is the writing — facts the product states
 * plainly rather than gaps.
 *
 * `root_address` is carried rather than looked up by: it is the label a person
 * cites, and what identifies the publication is its own ref.
 */
export const PublicationSchema = OwnedEntitySchema.extend({
  root: OwnedRefSchema,
  /** The address the root note sits at, so a listing needs no join. */
  root_address: AddressSchema,
  comments: CommentAccessSchema.default(DEFAULT_COMMENT_ACCESS),
  /**
   * Where the author's identity answered from when they last published. It is
   * read for one thing: an answer left by a stranger names an identity and
   * never a place, so somebody has to place it, and the author's own instance
   * is the one party to a deposit that is not the depositor. **Absent on a
   * publication written before this was kept, which takes no answers until it
   * is published again.**
   */
  identity_store: z.url().optional(),
});
export type Publication = z.infer<typeof PublicationSchema>;

/**
 * Publish a subtree. A note that already has a publication gets another version
 * of it rather than a second publication, so this is the whole of the act
 * either way.
 */
export const CreatePublicationRequestSchema = z.object({
  root: OwnedRefSchema,
});
export type CreatePublicationRequest = z.input<
  typeof CreatePublicationRequestSchema
>;

/** Change who is invited to comment. It publishes nothing: the terms of a
 *  conversation are not a version of the writing. */
export const UpdatePublicationRequestSchema = z.object({
  comments: CommentAccessSchema,
});
export type UpdatePublicationRequest = z.input<
  typeof UpdatePublicationRequestSchema
>;

/**
 * One version of a publication: everything below carries this ref, and deleting
 * it takes them with it. A version is written once and never edited — that is
 * what a peer is holding — so `created_at` is the moment it was made.
 *
 * `sequence` counts from 1 in publishing order and is the number a person
 * reads. It is assigned rather than derived: versions are only ever appended,
 * so counting the ones before it would answer the same forever, and the unique
 * index is what keeps two published in one moment from sharing a number.
 */
export const PublicationVersionSchema = OwnedEntitySchema.extend({
  publication: OwnedRefSchema,
  sequence: z.int().positive(),
});
export type PublicationVersion = z.infer<typeof PublicationVersionSchema>;

/**
 * One note as a version froze it, ready to serve: what is stored is the shape a
 * peer receives, so nothing is reshaped at read time and a signature stays over
 * the bytes that go out.
 *
 * `source` is the note it was copied from and the only home for its ref, so the
 * two cannot disagree; `address` is beside the node rather than inside it
 * because an index cannot seek on a nested path.
 */
export const SnapshotNodeSchema = OwnedEntitySchema.extend({
  version: OwnedRefSchema,
  /** The note as its author addresses it — the ref a peer receives. */
  source: OwnedRefSchema,
  address: AddressSchema,
  node: PublishedNodeSchema.omit({ ref: true }),
});
export type SnapshotNode = z.infer<typeof SnapshotNodeSchema>;

/**
 * Every snapshot node row crosses this, in both directions, for the reason
 * `parseNode` exists: `address` and `source` are immutable, so a row that gets
 * past here disagreeing with the node it carries is wrong for as long as it
 * exists.
 */
export function parseSnapshotNode(row: unknown): SnapshotNode {
  const snapshot = SnapshotNodeSchema.parse(row);
  if (snapshot.address !== snapshot.node.address) {
    throw new Error(
      `Published note ${snapshot.source} is filed at ${snapshot.address} and addressed ${snapshot.node.address}`,
    );
  }
  const { did } = splitOwnedRef(snapshot.source);
  if (splitOwnedRef(snapshot.version).did !== did) {
    throw new Error(
      `Published note ${snapshot.source} sits in ${snapshot.version}, which is somebody else's version`,
    );
  }
  return snapshot;
}

/**
 * One section as a version froze it. Flat rather than nesting the published
 * block, for the reason a held one is: every column but `content` is one an
 * index reads, and SurrealDB will not index a nested path.
 *
 * `content` cites the version's own copies of whatever it draws — never the
 * upload the author's own note reads.
 */
export const SnapshotBlockSchema = OwnedEntitySchema.extend({
  version: OwnedRefSchema,
  /** The section as its author addresses it — the ref a peer receives. */
  source: OwnedRefSchema,
  /** The note it belongs to, as its author addresses it. */
  node: OwnedRefSchema,
  ord: z.string().min(1),
  content: BlockDocumentSchema,
});
export type SnapshotBlock = z.infer<typeof SnapshotBlockSchema>;

/**
 * The publication's own copy of one asset a published section cites, and the
 * row that remembers which upload it was copied from. Both uploads are the
 * author's, and the copy is theirs to delete.
 *
 * It belongs to the PUBLICATION rather than to one version, because every
 * version of one stays readable and a copy outlives the version that made it.
 * docs/ARCHITECTURE.md § "Pictures".
 */
export const SnapshotAssetSchema = OwnedEntitySchema.extend({
  publication: OwnedRefSchema,
  /** The upload as the author's own note cites it. Private, and stays so. */
  source_upload: z.string().min(1),
  /** The copy a peer reads, and the one a published section cites. */
  public_upload: z.string().min(1),
});
export type SnapshotAsset = z.infer<typeof SnapshotAssetSchema>;

/** How many notes one answer lists. `total` counts them all, so a branch past
 *  this is told how many more moved than it can show. */
export const MAX_UNPUBLISHED_CHANGES = 200;

/**
 * What one note in a branch has done since the newest version of it went out.
 *
 * **This is not a comparison of the writing, and deliberately not.** Publishing
 * rewrites every picture a section cites to the copy the publication owns
 * (docs/ARCHITECTURE.md § "Pictures"), so comparing a draft's document against
 * a published one would report a difference for every picture in it and call
 * writing changed that nobody touched. What is answered is what can be told
 * without opening a section: which notes the branch gained and lost, which were
 * renamed or retagged, and which have been written in since.
 *
 * `title` is the note's title now, or the published one where the note is gone.
 */
export const UnpublishedChangeSchema = z.object({
  note: OwnedRefSchema,
  address: AddressSchema,
  title: z.string().max(512),
  change: z.enum(["added", "removed", "changed"]),
  /** What it was called in the version, where that is not what it is called
   *  now. */
  was_titled: z.string().max(512).optional(),
  tags_gained: TagsSchema,
  tags_lost: TagsSchema,
  /** A section of it was written or added since the version. A section taken
   *  out leaves nothing behind with a time on it, so it is not counted here. */
  written: z.boolean(),
});
export type UnpublishedChange = z.infer<typeof UnpublishedChangeSchema>;

/**
 * What a branch has done since it was last published, as its author is shown
 * before publishing it again — PRODUCT.md § "Design Principles" 5 puts the
 * truth about a publish at the moment of the decision.
 */
export const UnpublishedChangesSchema = z.object({
  publication: OwnedRefSchema,
  /** The version it is measured against. */
  since: PublishedVersionSchema,
  changes: z.array(UnpublishedChangeSchema).max(MAX_UNPUBLISHED_CHANGES),
  /** Every note that moved, however many are listed. */
  total: z.int().nonnegative(),
});
export type UnpublishedChanges = z.infer<typeof UnpublishedChangesSchema>;
