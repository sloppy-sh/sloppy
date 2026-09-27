// Sloppy's own API on the wire — what its routes accept and answer.
// `syr.ts` is this file's mirror for somebody else's routes.

import type { RecordId } from "surrealdb";
import { z } from "zod";
import { AddressSchema } from "./address.js";
import { type Block, BlockSchema } from "./block.js";
import { ownedRefFrom, splitOwnedRef } from "./codecs.js";
import {
  DidSyrSchema,
  type OwnedRef,
  OwnedRefSchema,
  PrincipalSchema,
  TimestampSchema,
  UlidSchema,
} from "./common.js";
import { RefusedVoiceSchema } from "./conversation.js";
import { looksRead } from "./edge.js";
import { GraphSchema } from "./graph.js";
import { AttributionSchema } from "./key-binding.js";
import { requireNodeConsistent } from "./node.js";
import { NodeSchema } from "./node.js";
import {
  PeerOriginSchema,
  type PulledBlock,
  type PulledNode,
  PullSchema,
} from "./federation.js";
import { PublicationSchema } from "./publication.js";
import { PublishedVersionSchema } from "./published.js";
import { TagSchema } from "./tag.js";

/**
 * A stored row as it crosses the wire: the composite key replaced by the
 * `<did>/<ulid>` reference the row is already pointed at by everywhere else.
 * Nothing else changes — a view is its row.
 *
 * The substitution is what makes a row expressible as JSON at all: the key is a
 * SurrealDB `RecordId`, which no JSON encoding round-trips back into the class
 * `RecordIdSchema` checks for.
 */
export function entityView<T extends { id: RecordId }>(
  row: T,
): Omit<T, "id"> & { ref: OwnedRef } {
  const { id, ...rest } = row;
  return { ...rest, ref: ownedRefFrom(id) };
}

export const NodeViewSchema = NodeSchema.omit({ id: true }).extend({
  ref: OwnedRefSchema,
  /** The addresses this note was at before it was moved, each of which still
   *  leads to it. Absent is a note that has never been moved. */
  aliases: z.array(AddressSchema).optional(),
  /** Whose the signature above makes it. **Absent is a note nothing weighed**
   *  — one carrying no signature, and every note of the reader's own, neither
   *  of which a surface may draw as questioned. */
  attribution: AttributionSchema.optional(),
});
export type NodeView = z.infer<typeof NodeViewSchema>;

/** A block on the wire carries no `text` — docs/ARCHITECTURE.md § "Data model". */
export const BlockViewSchema = BlockSchema.omit({
  id: true,
  text: true,
}).extend({
  ref: OwnedRefSchema,
});
export type BlockView = z.infer<typeof BlockViewSchema>;

/** A stored block on the wire. Built field by field: `entityView`'s spread
 *  would carry `text` out with it. */
export function blockView(row: Block): BlockView {
  return {
    ref: ownedRefFrom(row.id),
    created_by: row.created_by,
    node: row.node,
    ord: row.ord,
    content: row.content,
    deleted_at: row.deleted_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * A graph as a listing carries it. The home graph is listed like any other and
 * carries the ref its absence stands for, so a surface picking one has a single
 * kind of value to hold — whether or not a row has ever been written for it.
 */
export const GraphViewSchema = GraphSchema.omit({ id: true }).extend({
  ref: OwnedRefSchema,
});
export type GraphView = z.infer<typeof GraphViewSchema>;

/**
 * One tag somebody has used, and how many of their notes carry it. There is no
 * tag row to view — a tag exists exactly as long as a note holds it, so this is
 * counted from the notes rather than read from a table.
 */
export const TagCountSchema = z.object({
  tag: TagSchema,
  notes: z.int().positive(),
});
export type TagCount = z.infer<typeof TagCountSchema>;

/**
 * The author's own view of a publication: the chain, and the version a plain
 * read of it answers with. `latest` is read from the versions rather than kept
 * on the row, so there is one place a chain's newest version is written down.
 *
 * `identity_store` stays on the row: it is how this instance resolves a voice
 * somebody claims to be, and nothing a surface draws.
 */
export const PublicationViewSchema = PublicationSchema.omit({
  id: true,
  identity_store: true,
}).extend({ ref: OwnedRefSchema, latest: PublishedVersionSchema });
export type PublicationView = z.infer<typeof PublicationViewSchema>;

export const PullViewSchema = PullSchema.omit({ id: true }).extend({
  ref: OwnedRefSchema,
});
export type PullView = z.infer<typeof PullViewSchema>;

export const RefusedVoiceViewSchema = RefusedVoiceSchema.omit({
  id: true,
}).extend({ ref: OwnedRefSchema });
export type RefusedVoiceView = z.infer<typeof RefusedVoiceViewSchema>;

/**
 * One note the reader holds a copy of, and the region that handed it over —
 * what a citation to somebody else's note resolves to when the reader is
 * already holding one. The note is addressed by its AUTHOR, as every held note
 * is, and the region is where a surface opens it.
 */
export const PulledNoteHitSchema = z.object({
  note: NodeViewSchema,
  pull: PullViewSchema,
});
export type PulledNoteHit = z.infer<typeof PulledNoteHitSchema>;

/**
 * A held node as the rest of Sloppy reads it, addressed by its AUTHOR — which
 * is what `provenanceOf` in `@sloppy/graph` reads to draw it as foreign, and it
 * needs the viewer beside it to do so. `graph` is the author's too.
 *
 * `published` is asserted, not read: no publication row on this instance covers
 * a foreign node, and whether the author still publishes it is not something a
 * reader can learn, so this says what was true when the copy arrived. There are
 * no references, a published node travelling without them; the look is the
 * shape its author gave the mark, and the edge looks are the ones it set on its
 * lines, both of which do travel.
 */
export function pulledNodeView(row: PulledNode): NodeView {
  const { node } = row;
  return {
    ref: row.source,
    created_by: splitOwnedRef(row.source).owner,
    graph: row.source_graph,
    address: node.address,
    ...(node.aliases ? { aliases: node.aliases } : {}),
    depth: row.depth,
    parent: node.parent,
    origin: node.origin,
    owner: node.owner,
    authors: node.authors,
    contributors: node.contributors,
    title: node.title,
    tags: node.tags,
    links: node.links,
    ...(node.edges ? { edges: node.edges } : {}),
    appearance: node.look,
    published: true,
    created_at: node.created_at,
    updated_at: node.updated_at,
    content_signature: node.content_signature,
    signed_payload_json: node.signed_payload_json,
    signing_device_public_key: node.signing_device_public_key,
    signature_scheme: node.signature_scheme,
    ...(row.attribution === undefined ? {} : { attribution: row.attribution }),
  };
}

/**
 * A held block, likewise. The timestamps are the copy's own: a published block
 * carries none of the author's, so these say when the copy arrived.
 */
export function pulledBlockView(row: PulledBlock): BlockView {
  return {
    ref: row.source,
    created_by: splitOwnedRef(row.source).owner,
    node: row.node,
    ord: row.ord,
    content: row.content,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** `parseNode`'s boundary, on the wire: a node arrives checked or not at all. */
export function parseNodeView(value: unknown): NodeView {
  const view = NodeViewSchema.parse(value);
  requireNodeConsistent(view);
  if (view.edges === undefined) return view;
  return { ...view, edges: looksRead(view.edges) };
}

/**
 * What one bulk act did.
 *
 * `notes` is what the act left behind — every note it reached, as that note now
 * stands — and is empty where the act was to delete them, which is why the
 * count is its own field. `missed` is the rest of what was asked for: gone,
 * never the caller's, or — publishing — one this instance could not put out. An
 * act that reaches nothing is refused instead, so a reader of these two numbers
 * is always reading a partial success.
 */
export const NodeBulkResultSchema = z.object({
  reached: z.int().nonnegative(),
  missed: z.int().nonnegative(),
  notes: z.array(NodeViewSchema),
});
export type NodeBulkResult = z.infer<typeof NodeBulkResultSchema>;

/** {@link parseNodeView}'s boundary over a whole answer. */
export function parseNodeBulkResult(value: unknown): NodeBulkResult {
  const result = NodeBulkResultSchema.parse(value);
  return { ...result, notes: result.notes.map(parseNodeView) };
}

/**
 * A branch its author deleted, as the listing of what can still be put back
 * carries it. `ref` is the branch's root, `address` the label they cite it by,
 * and `notes` how many notes come back with it — the root and everything under
 * it — which is the size of the act a person is choosing.
 */
export const DeletedBranchSchema = z.object({
  ref: OwnedRefSchema,
  /** Absent is a branch with no address; `title` names it instead. */
  address: AddressSchema.optional(),
  graph: OwnedRefSchema,
  title: z.string(),
  deleted_at: TimestampSchema,
  notes: z.int().positive(),
});
export type DeletedBranch = z.infer<typeof DeletedBranchSchema>;

/**
 * One note a search found, as the result list shows it. `note` is what opens,
 * `address` is what the person reads it by, and `graph` is the graph that
 * address is read in — the author's, where `held` says the note came from
 * somebody else.
 *
 * `snippet` is the writing around what matched, plain and already cut to
 * length. It is empty where nothing in the writing matched — a hit on the title
 * or the address alone.
 */
export const SearchHitSchema = z.object({
  note: OwnedRefSchema,
  /** Absent is a note its author has given no address; `title` is what a
   *  reader has to go on then, as `noteLabel` says. */
  address: AddressSchema.optional(),
  graph: OwnedRefSchema,
  title: z.string(),
  snippet: z.string().default(""),
  /** When the note was written, which is what settles the order of two hits
   *  neither of which carries an address. Absent from an answer made before it
   *  travelled, and such a pair falls back to the reference. */
  created_at: TimestampSchema.optional(),
  /** The address the note was reached by, where it has since been carried away
   *  from that one. Absent is a note reached by where it is now. */
  wasAt: AddressSchema.optional(),
  /** Whether this is a copy of somebody else's note rather than one of the
   *  reader's own. Absent is their own. */
  held: z.boolean().default(false),
});
export type SearchHit = z.infer<typeof SearchHitSchema>;

/** The most hits `GET /nodes/search` answers with. */
export const MAX_SEARCH_HITS = 50;

/**
 * How many notes `GET /nodes/recent` answers with when the caller asks for no
 * number, and the most it will answer with at all.
 */
export const RECENT_NOTES = 20;
export const MAX_RECENT_NOTES = 100;

/**
 * Everything `did` keeps, as JSON they can hold. A deleted note is not part of
 * it, and a section carries its document exactly as it is stored.
 */
export const GraphExportSchema = z.object({
  exported_at: TimestampSchema,
  did: DidSyrSchema,
  graphs: z.array(GraphViewSchema),
  notes: z.array(NodeViewSchema),
  blocks: z.array(BlockViewSchema),
});
export type GraphExport = z.infer<typeof GraphExportSchema>;

/**
 * How large an archive this instance will take in, and how many notes it will
 * read out of one. Both are stated in the words a refusal is given in, so
 * nobody has to guess which of the two they hit.
 */
export const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
export const MAX_ARCHIVE_NOTES = 5000;

/** Which copy of something a person kept when two graphs disagreed: the one
 *  already here, or the one the archive brought. */
export const ImportSideSchema = z.enum(["mine", "theirs"]);
export type ImportSide = z.infer<typeof ImportSideSchema>;

/**
 * What the two copies of one graph disagree about — a note both sides wrote
 * into, a note whose sections they each changed, or a number they have on
 * different notes.
 */
export const ImportConflictKindSchema = z.enum(["note", "address", "section"]);
export type ImportConflictKind = z.infer<typeof ImportConflictKindSchema>;

/**
 * One disagreement, said in the words a person settles it in —
 * docs/ARCHITECTURE.md § "A graph on disk".
 *
 * `ref` is the note it is about. `mine` and `theirs` are what each side holds,
 * as words rather than as rows: nobody settles a merge by reading a document.
 */
export const ImportConflictSchema = z.object({
  kind: ImportConflictKindSchema,
  ref: OwnedRefSchema,
  /** The other note carrying the number, on an `address` conflict. Absent on
   *  the other two, which are about one note. */
  other: OwnedRefSchema.optional(),
  /** The number the two notes both carry, on an `address` conflict. Absent
   *  otherwise. */
  address: AddressSchema.optional(),
  /** The sections both sides wrote into, on a `section` conflict, each with
   *  what either side wrote there in words so a person can choose between
   *  them. Empty on the other two. */
  sections: z
    .array(
      z.object({
        section: UlidSchema,
        mine: z.string(),
        theirs: z.string(),
      }),
    )
    .default([]),
  mine: z.string(),
  theirs: z.string(),
});
export type ImportConflict = z.infer<typeof ImportConflictSchema>;

/** How one conflict was settled. `keep` is the side taken for the note as a
 *  whole, and for every section `sections` does not name. */
export const ImportResolutionSchema = z.object({
  kind: ImportConflictKindSchema,
  ref: OwnedRefSchema,
  keep: ImportSideSchema,
  /** Section by section, where the two sides wrote into one note. Empty is the
   *  whole note from `keep`. */
  sections: z
    .array(z.object({ section: UlidSchema, keep: ImportSideSchema }))
    .default([]),
  /** Which note keeps the number, on an `address` conflict. Absent leaves it
   *  with the note the `keep` side puts there. */
  numbered: OwnedRefSchema.optional(),
});
export type ImportResolution = z.infer<typeof ImportResolutionSchema>;

/** How a person settled every conflict an import raised. Absent, and empty,
 *  are an import with nothing to settle. */
export const ImportSettlementSchema = z.object({
  resolutions: z.array(ImportResolutionSchema).default([]),
});
export type ImportSettlement = z.input<typeof ImportSettlementSchema>;

/**
 * What an archive would bring, answered before anything is written —
 * docs/ARCHITECTURE.md § "A graph on disk".
 *
 * `format`, `graph`, `name` and `owner` are what the archive says about itself;
 * the rest is what it means for the person importing it.
 */
export const ArchivePreviewSchema = z.object({
  format: z.int(),
  /** The graph's own ULID, which is what says whether this replaces one. */
  graph: UlidSchema,
  name: z.string(),
  owner: DidSyrSchema,
  notes: z.int().nonnegative(),
  pictures: z.int().nonnegative(),
  /** How many changes offered on those notes the archive carries. Absent is
   *  none, which is what every archive taken out before an offer could travel
   *  says. */
  offers: z.int().positive().optional(),
  /** The shortcodes the notes are written with that the importer's own catalog
   *  has no picture for. Each one arrives, and renders as its shortcode. */
  missing_emoji: z.array(z.string()),
  /** Notes the importer already keeps elsewhere that this archive also holds.
   *  An import is refused while any is here. */
  collisions: z.array(OwnedRefSchema),
  /** Whether this writes over a graph the importer already keeps rather than
   *  opening a new one. */
  replaces: z.boolean(),
  /** How many notes that graph holds now, every one of which the import takes
   *  with it — the ones in the bin included, which no archive carries. Zero
   *  where this opens a graph of its own. */
  replacing: z.int().nonnegative(),
  /** Whether this archive is a copy of a graph the importer already keeps, so
   *  the two are settled note by note rather than one written over the other.
   *  Absent is false — an answer made before an import could merge. */
  merges: z.boolean().default(false),
  /** What the two copies disagree about, for a person to settle before
   *  anything is written. Absent, and empty, are nothing to settle. */
  conflicts: z.array(ImportConflictSchema).default([]),
});
export type ArchivePreview = z.infer<typeof ArchivePreviewSchema>;

/**
 * What another copy of a graph this device already keeps would bring, answered
 * before anything is written — docs/ARCHITECTURE.md § "A graph on disk".
 *
 * An archive is one way such a copy arrives and {@link ArchivePreviewSchema} is
 * what an archive answers, carrying everything the file says about itself. A
 * copy that arrives as a vault says nothing about itself, so this is the
 * merge's half alone: which graph it is a copy of, how much of it there is, and
 * what the two copies disagree about.
 */
export const VaultPreviewSchema = z.object({
  /** The graph on this device the copy is of. A vault that is a copy of no
   *  graph here is refused rather than previewed: nothing in it could be
   *  settled into anything. */
  graph: OwnedRefSchema,
  notes: z.int().nonnegative(),
  pictures: z.int().nonnegative(),
  /** The notes the copy would put in the bin: ones the state it was taken from
   *  held and it does not. Empty for a copy taken from no state of this graph,
   *  where a note it does not hold is one it never had. */
  binning: z.array(OwnedRefSchema).default([]),
  /** What the two copies disagree about, for a person to settle before
   *  anything is written. Empty is nothing to settle. */
  conflicts: z.array(ImportConflictSchema).default([]),
});
export type VaultPreview = z.infer<typeof VaultPreviewSchema>;

/**
 * Who the API believes is calling.
 *
 * `did` names them the way a note's owner and a role's member are named: it is
 * compared, and nothing here resolves it. `syr_instance_url` and
 * `delegate_public_key` describe a syr sign-in, and `delegate_public_key` is
 * the PUBLIC half of the key that instance signs this platform's content with.
 * Sloppy never holds the private half; code here that wants to sign locally has
 * misread the delegation model.
 *
 * **Both are absent, together, for a viewer who signed in by signing with a key
 * of their own.** There is no instance holding an identity for them and no key
 * Sloppy may sign with as them, so a surface that wants either asks whether it
 * is there rather than assuming it, and a route that acts on an identity store
 * refuses them the way it refuses anybody without a delegation.
 */
export const ViewerSchema = z.object({
  did: PrincipalSchema,
  syr_instance_url: z.url().optional(),
  delegate_public_key: z.string().min(1).optional(),
});
export type Viewer = z.infer<typeof ViewerSchema>;

/**
 * Begin Platform Delegation against an instance. `redirect` names where the
 * person lands afterwards; the API decides which targets it will honour, so an
 * unacceptable one is dropped rather than refused.
 */
export const StartLoginRequestSchema = z.object({
  instance_url: z.url(),
  redirect: z.string().min(1).optional(),
});
export type StartLoginRequest = z.input<typeof StartLoginRequestSchema>;

export const ConsentRedirectSchema = z.object({ consent_url: z.url() });
export type ConsentRedirect = z.infer<typeof ConsentRedirectSchema>;

/**
 * Trade a consent callback's code for a session, for a client that received the
 * callback itself — the native shell's deep link. A browser that lands back on
 * the API instead never sends this: it already has the session.
 */
export const ExchangeSessionRequestSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});
export type ExchangeSessionRequest = z.input<
  typeof ExchangeSessionRequestSchema
>;

/** Ask for something to sign, as whoever this names. */
export const SignInChallengeRequestSchema = z.object({
  principal: PrincipalSchema,
});
export type SignInChallengeRequest = z.input<
  typeof SignInChallengeRequestSchema
>;

/**
 * What a key of that principal's own is asked to sign: the whole text, good
 * once, and good only until `expires_at`.
 *
 * The text names the identity and the instance inside itself, so what a person
 * reads before signing is what the signature is held to — which is what stops
 * one Sloppy from passing another's text off as its own.
 */
export const SignInChallengeSchema = z.object({
  statement: z.string().min(1),
  expires_at: TimestampSchema,
});
export type SignInChallenge = z.infer<typeof SignInChallengeSchema>;

/**
 * The signed answer. `statement` is the text that was signed, byte for byte: a
 * signature is over bytes, so what is presented is what is checked, and a
 * statement that does not rebuild into the one this instance issued is refused
 * before any key is asked about.
 */
export const AnswerChallengeRequestSchema = z.object({
  statement: z.string().min(1).max(4096),
  signature: z.string().min(1).max(16384),
});
export type AnswerChallengeRequest = z.input<
  typeof AnswerChallengeRequestSchema
>;

/**
 * Where this Sloppy's own identities live, and where a peer reaches the graph
 * it serves.
 *
 * `instance_url` is `null` where this instance only ever delegates elsewhere,
 * which is a different answer from one that could not be had.
 * `instance_origin` is what somebody types to pull a branch from here; absent
 * where the instance named none, and where what it named cannot be spelled as
 * an origin — the way in beside it is worth more than the whole answer.
 */
export const OwnInstanceSchema = z.object({
  instance_url: z.string().min(1).nullable().catch(null),
  instance_origin: PeerOriginSchema.optional().catch(undefined),
});
export type OwnInstance = z.infer<typeof OwnInstanceSchema>;

export const SessionSchema = z.object({
  token: z.string().min(1),
  expires_at: TimestampSchema,
  viewer: ViewerSchema,
});
export type Session = z.infer<typeof SessionSchema>;

export const ServiceStatusSchema = z.enum(["up", "down"]);
export type ServiceStatus = z.infer<typeof ServiceStatusSchema>;

/** What an API instance depends on. A new dependency is a value here. */
export const ServiceDependencySchema = z.enum([
  "database",
  "object_storage",
  "identity",
]);
export type ServiceDependency = z.infer<typeof ServiceDependencySchema>;

/**
 * `status` is `degraded` when any check is down, and the API answers 503 with
 * this same body then — so a reader parses the report either way.
 */
export const HealthReportSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  checks: z.array(
    z.object({
      dependency: ServiceDependencySchema,
      status: ServiceStatusSchema,
    }),
  ),
});
export type HealthReport = z.infer<typeof HealthReportSchema>;
