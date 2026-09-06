// What a peer reads off somebody's instance, and the boundary every answer is
// held to.
//
// Federation is pull-only, so this is a read contract rather than a delivery
// one: a publication is a chain of snapshots an author has made readable, and a
// peer fetches whichever one it likes whenever it likes. `publication.ts` is
// the rows behind it. See docs/ARCHITECTURE.md § "Federating the graph".

import {
  type Address,
  AddressSchema,
  isInSubtree,
  parentAddress,
} from "./address.js";
import { z } from "zod";
import { NodeAppearanceSchema } from "./appearance.js";
import { splitOwnedRef } from "./codecs.js";
import { BlockDocumentSchema, citedUploads } from "./document.js";
import {
  type DidSyr,
  DidSyrSchema,
  type OwnedRef,
  OwnedRefSchema,
  TimestampSchema,
} from "./common.js";
import { homeGraphRef } from "./graph.js";
import { TagsSchema } from "./tag.js";

/**
 * How much of somebody else's graph ONE ANSWER may carry, and how many answers
 * a reader takes before it stops asking. A page past one of these is refused
 * whole; a region longer than a page carries a cursor instead.
 *
 * The counts bound a page that has been PARSED. `MAX_PUBLISHED_PAGE_BYTES`
 * bounds the answer as it ARRIVES, and the fetch is where that one is enforced.
 * docs/ARCHITECTURE.md § "Federating the graph" says why an outbound fetch
 * needs both.
 */
export const MAX_PUBLISHED_PUBLICATIONS_PER_PAGE = 500;
export const MAX_PUBLISHED_NODES_PER_PAGE = 2_000;
export const MAX_PUBLISHED_BLOCKS_PER_PAGE = 10_000;
export const MAX_PUBLISHED_VERSIONS_PER_PAGE = 500;
export const MAX_PUBLISHED_CHANGES_PER_PAGE = 500;
export const MAX_PUBLISHED_PAGES = 128;
export const MAX_PUBLISHED_PAGE_BYTES = 16 * 1024 * 1024;

/**
 * Where the answer resumes. Minted by the instance that served the page and
 * handed back to it untouched — what it means is that instance's own, so
 * nothing here reads one.
 */
export const PageCursorSchema = z.string().min(1).max(512);
export type PageCursor = z.infer<typeof PageCursorSchema>;

/**
 * Who the author invites to comment on what a publication carries. An open set:
 * a narrower invitation — only the identities the author follows, say — is a
 * value here and a branch where a conversation is assembled, never a column.
 *
 * It is an invitation and not a lock. A comment lives in the store of whoever
 * wrote it and syr asks nobody's permission to hold one, so this decides what
 * an instance serves and what a surface offers. Copy that claims it stops
 * anybody writing one is claiming something Sloppy cannot do.
 *
 * Closed, because this is what an author may ASK for: an invitation stored and
 * then not honoured is worse than a request that fails.
 * {@link ReceivedCommentAccessSchema} is the same field arriving.
 */
export const CommentAccessSchema = z.enum(["anyone", "nobody"]);
export type CommentAccess = z.infer<typeof CommentAccessSchema>;

export const DEFAULT_COMMENT_ACCESS: CommentAccess = "anyone";

/**
 * The same field as a PEER sends it, where the set is open at the far end and a
 * page is refused WHOLE. An invitation this build has no branch for reads as
 * `nobody`: carrying a conversation on terms it cannot describe is the one
 * answer worse than carrying none, and refusing would cost the reader every
 * note in the region over a word about who may reply.
 */
export const ReceivedCommentAccessSchema = CommentAccessSchema.catch("nobody");

/**
 * One snapshot in a publication's chain, as everything that names one carries
 * it. `sequence` counts from 1 in the order they were published, so it is the
 * number a person reads; `ref` is what a route binds.
 */
export const PublishedVersionSchema = z.object({
  ref: OwnedRefSchema,
  sequence: z.int().positive(),
  published_at: TimestampSchema,
});
export type PublishedVersion = z.infer<typeof PublishedVersionSchema>;

/**
 * One publication an identity serves, as an instance lists it: enough to choose
 * one and pull it, and nothing that is not already public in it.
 *
 * `root_address` is a label a person cites and reads a shape from, not what the
 * publication is found by — `ref` is. `graph` is which of the author's
 * notebooks that label is read in, absent for their home graph and so for
 * everything published before an author could have a second. `title` and
 * `latest` are the newest version's, which is what a plain read of the
 * publication answers with.
 */
export const PublishedPublicationSchema = z.object({
  ref: OwnedRefSchema,
  root_address: AddressSchema,
  graph: OwnedRefSchema.optional(),
  /**
   * What the author calls that notebook. A label a reader shows beside an
   * address so two `1a`s from one author read apart, and never what the
   * notebook is found by — `graph` is. Absent is a notebook whose name did not
   * travel, which is everything served before one could.
   */
  graph_title: z.string().max(512).optional(),
  title: z.string().max(512),
  latest: PublishedVersionSchema,
});
export type PublishedPublication = z.infer<typeof PublishedPublicationSchema>;

/**
 * One page of what an identity publishes on one instance — the answer to "I
 * follow this person, what can I read?", which a DID alone cannot give: nothing
 * in syr's identity manifest names where somebody's graph is served, so the
 * instance is asked and never derived. docs/ARCHITECTURE.md § "Federating the
 * graph".
 *
 * A page stands on its own: one entry is one publication, and nothing in it
 * refers to an entry on another page.
 */
export const PublishedIndexSchema = z.object({
  did: DidSyrSchema,
  publications: z
    .array(PublishedPublicationSchema)
    .max(MAX_PUBLISHED_PUBLICATIONS_PER_PAGE),
  /** Absent on the last page. */
  next_cursor: PageCursorSchema.optional(),
});
export type PublishedIndex = z.infer<typeof PublishedIndexSchema>;

/**
 * A note's look as it TRAVELS: the shape channels of {@link NodeAppearance} and
 * no others. A picture is an upload in the author's own store and what a peer
 * may read of one is docs/ARCHITECTURE.md § "Pictures"' open question, so the
 * channels that are plain shape go and the ones that name bytes stay behind.
 * DESIGN.md § "A note's look never uses colour" carries the ruling.
 *
 * The channels are spelled as the author's own row spells them, so a reader
 * resolves one through `resolveAppearance` exactly as it resolves a note of its
 * own — and a look with no picture in it resolves to a mark wearing none.
 */
export const PublishedLookSchema = NodeAppearanceSchema.pick({
  ring_weight: true,
  ring_style: true,
  mark_radius: true,
  mark_scale: true,
});
export type PublishedLook = z.infer<typeof PublishedLookSchema>;

/**
 * One node as a peer receives it, frozen as it stood when the version was
 * published. Rows travel by `<did>/<ulid>` reference rather than by record id,
 * and carry no `depth`: a reader computes it, the sector, and which addresses
 * lie under which, from the address.
 *
 * **Every ref on it names a note the caller may read**, because this whole
 * shape reaches an anonymous one. A `<did>/<ulid>` is not readable by itself,
 * but it says a note exists and when it was written; the three fields below
 * each carry the rule that keeps one out.
 */
export const PublishedNodeSchema = z.object({
  ref: OwnedRefSchema,
  address: AddressSchema,
  /** Absent on the region's own root, whose parent is outside the publication
   *  and is not named. */
  parent: OwnedRefSchema.optional(),
  /**
   * The root of the REGION, not of the author's tree: a publication rooted
   * below depth 1 would otherwise name a note nobody published. What a peer
   * holds is a tree rooted here, so its root is its own origin the way any root
   * is.
   */
  origin: OwnedRefSchema,
  title: z.string().max(512),
  tags: TagsSchema,
  /** How its author asked the mark to be drawn. Absent is a mark that draws
   *  unstyled, which is every version published before a look could travel. */
  look: PublishedLookSchema.optional(),
  /** Only targets the same author had published when this version was made. A
   *  link to a note nobody published is dropped rather than named. */
  links: z.array(OwnedRefSchema),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  /**
   * Present when the author signed this node through their syr instance. A
   * reader that cannot verify a signature still renders the node; a reader that
   * can, and finds it wrong, must not present it as the author's.
   */
  content_signature: z.string().optional(),
  signed_payload_json: z.string().optional(),
  signing_device_public_key: z.string().optional(),
});
export type PublishedNode = z.infer<typeof PublishedNodeSchema>;

/**
 * One section as a peer receives it. Every asset `content` cites is an upload
 * the publication owns a copy of — never the private original the author's own
 * note reads — so what a peer holds answers for them however the author's own
 * library changes afterwards; docs/ARCHITECTURE.md § "Pictures" is the ruling.
 */
export const PublishedBlockSchema = z.object({
  ref: OwnedRefSchema,
  node: OwnedRefSchema,
  ord: z.string().min(1),
  content: BlockDocumentSchema,
});
export type PublishedBlock = z.infer<typeof PublishedBlockSchema>;

/**
 * One answer from a peer's public endpoint: a page of one version of one
 * publication.
 *
 * `comments` is the author's invitation as it stands NOW rather than as the
 * version froze it — the snapshot is what a peer reads, and who is welcome to
 * answer it is a live term of the author's.
 *
 * `graph` is the notebook every address on the page is read in; absent is the
 * author's home graph, and `graph_title` is what the author calls it.
 */
export const PublishedSubtreePageSchema = z.object({
  publication: OwnedRefSchema,
  version: PublishedVersionSchema,
  root_address: AddressSchema,
  graph: OwnedRefSchema.optional(),
  graph_title: z.string().max(512).optional(),
  comments: ReceivedCommentAccessSchema,
  nodes: z.array(PublishedNodeSchema).max(MAX_PUBLISHED_NODES_PER_PAGE),
  blocks: z.array(PublishedBlockSchema).max(MAX_PUBLISHED_BLOCKS_PER_PAGE),
  /** Absent on the last page. */
  next_cursor: PageCursorSchema.optional(),
});
export type PublishedSubtreePage = z.infer<typeof PublishedSubtreePageSchema>;

/** Every page of one version, assembled: what a caller holds once the last page
 *  is in. The wire carries pages, so nothing parses this. */
export interface PublishedSubtree {
  publication: OwnedRef;
  version: PublishedVersion;
  root_address: Address;
  graph?: OwnedRef;
  graph_title?: string;
  comments: CommentAccess;
  nodes: PublishedNode[];
  blocks: PublishedBlock[];
}

/** One page of a publication's chain, newest version first. */
export const PublishedVersionsPageSchema = z.object({
  publication: OwnedRefSchema,
  versions: z
    .array(PublishedVersionSchema)
    .max(MAX_PUBLISHED_VERSIONS_PER_PAGE),
  /** Absent on the last page. */
  next_cursor: PageCursorSchema.optional(),
});
export type PublishedVersionsPage = z.infer<typeof PublishedVersionsPageSchema>;

/**
 * What became of one section between two versions. `section` is the section as
 * the LATER version has it, except where it is gone, which leaves only the side
 * that still exists.
 */
export const PublishedSectionChangeSchema = z.discriminatedUnion("change", [
  z.object({ change: z.literal("added"), section: PublishedBlockSchema }),
  z.object({ change: z.literal("removed"), section: PublishedBlockSchema }),
  z.object({
    change: z.literal("changed"),
    section: PublishedBlockSchema,
    before: PublishedBlockSchema,
  }),
]);
export type PublishedSectionChange = z.infer<
  typeof PublishedSectionChangeSchema
>;

/** One entry carries a whole stack, so it is held to what a whole page of
 *  sections is held to. */
const SectionChangesSchema = z
  .array(PublishedSectionChangeSchema)
  .max(MAX_PUBLISHED_BLOCKS_PER_PAGE);

/**
 * What became of one note between two versions, and enough of both sides to
 * draw the difference without holding either version.
 *
 * A note that is gone carries no sections: what it said is in the version that
 * still has it, which is a read a reader makes when it wants one. A note that
 * arrived carries its whole stack, every section of it added, so one render
 * path draws both it and a note that changed.
 */
export const PublishedNoteChangeSchema = z.discriminatedUnion("change", [
  z.object({
    change: z.literal("added"),
    note: PublishedNodeSchema,
    sections: SectionChangesSchema,
  }),
  z.object({ change: z.literal("removed"), note: PublishedNodeSchema }),
  z.object({
    change: z.literal("changed"),
    note: PublishedNodeSchema,
    before: PublishedNodeSchema,
    sections: SectionChangesSchema,
  }),
]);
export type PublishedNoteChange = z.infer<typeof PublishedNoteChangeSchema>;

/**
 * One page of the difference between two versions, in address order.
 *
 * The instance holds every version and the reader holds none, so the comparison
 * is made where the versions are: a phone asking what changed between two
 * snapshots of a ten-thousand-note branch reads the difference rather than both
 * sides of it. Where one address holds a different note in each version, that
 * is one note gone and another arrived, and the reader is told both.
 */
export const PublishedChangesPageSchema = z.object({
  publication: OwnedRefSchema,
  root_address: AddressSchema,
  /** The versions compared, in that order. */
  from: OwnedRefSchema,
  to: OwnedRefSchema,
  changes: z
    .array(PublishedNoteChangeSchema)
    .max(MAX_PUBLISHED_CHANGES_PER_PAGE),
  /** Absent on the last page. */
  next_cursor: PageCursorSchema.optional(),
});
export type PublishedChangesPage = z.infer<typeof PublishedChangesPageSchema>;

/** An answer from a peer that is not the answer that was asked for. */
export class UnaskedAnswerError extends Error {
  constructor(reason: string, cause?: unknown) {
    super(`A peer answered with ${reason}`, { cause });
    this.name = "UnaskedAnswerError";
  }
}

/** One page of a peer's listing, held to the identity it was asked about. */
export function parsePublishedIndex(
  body: unknown,
  did: DidSyr,
): PublishedIndex {
  const read = PublishedIndexSchema.safeParse(body);
  if (!read.success) {
    throw new UnaskedAnswerError("something that is not a listing", read.error);
  }
  if (read.data.did !== did) {
    throw new UnaskedAnswerError(`about ${read.data.did}`);
  }
  for (const publication of read.data.publications) {
    requireAuthor(publication.ref, did);
    requireAuthor(publication.latest.ref, did);
    if (publication.graph !== undefined) {
      requireAuthor(publication.graph, did);
    }
  }
  return read.data;
}

/**
 * The same boundary over a RUN of listing pages: what a caller uses when it
 * follows `next_cursor` to the end rather than showing one page. A publication
 * is listed once, so it arrives once — and a run of pages ends, the way a
 * region's does.
 */
export interface PublishedIndexReader {
  take(body: unknown): PublishedIndex;
}

export function publishedIndexReader(asked: {
  did: DidSyr;
}): PublishedIndexReader {
  const held = new Set<OwnedRef>();
  let pages = 0;

  return {
    take(body: unknown): PublishedIndex {
      requirePage(pages);
      const page = parsePublishedIndex(body, asked.did);
      const onPage = new Set<OwnedRef>();
      for (const publication of page.publications) {
        if (held.has(publication.ref) || onPage.has(publication.ref)) {
          throw new UnaskedAnswerError(`${publication.ref} twice`);
        }
        onPage.add(publication.ref);
      }
      pages += 1;
      for (const ref of onPage) held.add(ref);
      return page;
    },
  };
}

/** What a reader asked one publication for. */
export interface AskedSubtree {
  publication: OwnedRef;
  /** Absent asks for the newest version, and the first page says which it was. */
  version?: OwnedRef;
}

/**
 * Reads one version of one publication, holding every page to what was asked
 * for and to the pages already taken: a note's parent may have arrived on an
 * earlier one, and a note may not claim an address another already has, on this
 * page or any before it — the address rule our own rows are held to, on rows a
 * peer handed us, and it reaches this far unchanged because a region lies in
 * ONE of the author's graphs. A note hangs off the note at its own parent
 * address, so the tree a peer draws is the one its addresses already state.
 *
 * Every page carries one version and one graph, and each is the same one all
 * the way through: a run that changed either half way would splice two
 * snapshots, or two notebooks, into one region.
 */
export interface PublishedSubtreeReader {
  /**
   * One answer. A page is taken WHOLE or refused whole — what gets past is
   * written into the reader's own store under the author's name — and a refused
   * page leaves the reader holding exactly what it held before. `next_cursor`
   * on what comes back is the page to ask for next.
   */
  take(body: unknown): PublishedSubtreePage;
  /** Every note this version has served, which is what a refresh sweeps against
   *  once the last page is in. docs/ARCHITECTURE.md § "Federating the graph". */
  served(): Set<OwnedRef>;
}

export function publishedSubtreeReader(
  asked: AskedSubtree,
): PublishedSubtreeReader {
  const author = splitOwnedRef(asked.publication).did;
  const heldNodes = new Set<OwnedRef>();
  const heldByAddress = new Map<Address, OwnedRef>();
  const heldBlocks = new Set<OwnedRef>();
  let regionRoot: OwnedRef | undefined;
  let heldVersion: OwnedRef | undefined;
  let heldAddress: Address | undefined;
  let heldGraph: OwnedRef | undefined;
  let pages = 0;

  return {
    take(body: unknown): PublishedSubtreePage {
      requirePage(pages);
      const read = PublishedSubtreePageSchema.safeParse(body);
      if (!read.success) {
        throw new UnaskedAnswerError(
          "something that is not a region",
          read.error,
        );
      }
      const page = read.data;
      if (page.publication !== asked.publication) {
        throw new UnaskedAnswerError(`the publication at ${page.publication}`);
      }
      requireAuthor(page.version.ref, author);
      if (asked.version !== undefined && page.version.ref !== asked.version) {
        throw new UnaskedAnswerError(`version ${page.version.sequence}`);
      }
      if (heldVersion !== undefined && page.version.ref !== heldVersion) {
        throw new UnaskedAnswerError("a second version of one region");
      }
      if (heldAddress !== undefined && page.root_address !== heldAddress) {
        throw new UnaskedAnswerError(
          `a region rooted at ${page.root_address} and at ${heldAddress}`,
        );
      }
      if (page.graph !== undefined) requireAuthor(page.graph, author);
      // Resolved rather than compared as it arrived: absent and the home
      // graph's own ref are one graph said two ways, and a peer that spells it
      // the other way has not changed its answer half way through.
      const graph = page.graph ?? homeGraphRef(author);
      if (heldGraph !== undefined && graph !== heldGraph) {
        throw new UnaskedAnswerError("a region in two of one author's graphs");
      }
      const rootAddress = page.root_address;
      const root =
        regionRoot ?? page.nodes.find((n) => n.address === rootAddress)?.ref;
      if (root === undefined) {
        throw new UnaskedAnswerError("a region without its own root");
      }

      const pageNodes = new Set<OwnedRef>();
      const pageByAddress = new Map<Address, OwnedRef>();
      for (const node of page.nodes) {
        requireAuthor(node.ref, author);
        for (const target of node.links) requireAuthor(target, author);
        if (!isInSubtree(rootAddress, node.address)) {
          throw new UnaskedAnswerError(`a note at ${node.address}`);
        }
        if (heldNodes.has(node.ref) || pageNodes.has(node.ref)) {
          throw new UnaskedAnswerError(`${node.ref} twice`);
        }
        if (
          heldByAddress.has(node.address) ||
          pageByAddress.has(node.address)
        ) {
          throw new UnaskedAnswerError(`a second note at ${node.address}`);
        }
        pageNodes.add(node.ref);
        pageByAddress.set(node.address, node.ref);
      }
      for (const node of page.nodes) {
        if (node.origin !== root) {
          throw new UnaskedAnswerError(`a note rooted at ${node.origin}`);
        }
        if (node.address === rootAddress) {
          if (node.parent !== undefined) {
            throw new UnaskedAnswerError("a root pointing outside the region");
          }
          continue;
        }
        const above = parentAddress(node.address) ?? rootAddress;
        const sprangFrom = heldByAddress.get(above) ?? pageByAddress.get(above);
        if (sprangFrom === undefined || node.parent !== sprangFrom) {
          throw new UnaskedAnswerError(
            `a note at ${node.address} that does not spring from ${above}`,
          );
        }
      }

      const pageBlocks = new Set<OwnedRef>();
      for (const block of page.blocks) {
        requireAuthor(block.ref, author);
        if (heldBlocks.has(block.ref) || pageBlocks.has(block.ref)) {
          throw new UnaskedAnswerError(`${block.ref} twice`);
        }
        if (!heldNodes.has(block.node) && !pageNodes.has(block.node)) {
          throw new UnaskedAnswerError(`a section of ${block.node}`);
        }
        // The one reference with an outbound fetch behind it: an upload the
        // answer cites is what the reader's instance goes and asks for.
        for (const upload of citedUploads(block.content)) {
          requireAuthor(upload as OwnedRef, author);
        }
        pageBlocks.add(block.ref);
      }

      regionRoot = root;
      heldVersion = page.version.ref;
      heldAddress = rootAddress;
      heldGraph = graph;
      pages += 1;
      for (const node of page.nodes) {
        heldNodes.add(node.ref);
        heldByAddress.set(node.address, node.ref);
      }
      for (const ref of pageBlocks) heldBlocks.add(ref);
      return page;
    },

    served(): Set<OwnedRef> {
      return new Set(heldNodes);
    },
  };
}

/**
 * One publication's chain, held to the publication it was asked about. The
 * chain is served newest first and a sequence is assigned once, so a run whose
 * numbers stop falling is repeating itself or reordering the history.
 */
export interface PublishedVersionsReader {
  take(body: unknown): PublishedVersionsPage;
}

export function publishedVersionsReader(asked: {
  publication: OwnedRef;
}): PublishedVersionsReader {
  const author = splitOwnedRef(asked.publication).did;
  let previous: number | undefined;
  let pages = 0;

  return {
    take(body: unknown): PublishedVersionsPage {
      requirePage(pages);
      const read = PublishedVersionsPageSchema.safeParse(body);
      if (!read.success) {
        throw new UnaskedAnswerError(
          "something that is not a history",
          read.error,
        );
      }
      const page = read.data;
      if (page.publication !== asked.publication) {
        throw new UnaskedAnswerError(`the publication at ${page.publication}`);
      }
      for (const version of page.versions) {
        requireAuthor(version.ref, author);
        if (previous !== undefined && version.sequence >= previous) {
          throw new UnaskedAnswerError(
            `version ${version.sequence} out of turn`,
          );
        }
        previous = version.sequence;
      }
      pages += 1;
      return page;
    },
  };
}

/**
 * The difference between two versions, held to the pair that was asked about
 * and to the region they belong to: a note outside it, one somebody else wrote,
 * or one that changed twice is an answer to a question nobody asked.
 */
export interface PublishedChangesReader {
  take(body: unknown): PublishedChangesPage;
}

export function publishedChangesReader(asked: {
  publication: OwnedRef;
  from: OwnedRef;
  to: OwnedRef;
}): PublishedChangesReader {
  const author = splitOwnedRef(asked.publication).did;
  const held = new Set<OwnedRef>();
  let heldAddress: Address | undefined;
  let pages = 0;

  return {
    take(body: unknown): PublishedChangesPage {
      requirePage(pages);
      const read = PublishedChangesPageSchema.safeParse(body);
      if (!read.success) {
        throw new UnaskedAnswerError(
          "something that is not a difference",
          read.error,
        );
      }
      const page = read.data;
      if (page.publication !== asked.publication) {
        throw new UnaskedAnswerError(`the publication at ${page.publication}`);
      }
      if (page.from !== asked.from || page.to !== asked.to) {
        throw new UnaskedAnswerError("a difference between other versions");
      }
      if (heldAddress !== undefined && page.root_address !== heldAddress) {
        throw new UnaskedAnswerError(
          `a region rooted at ${page.root_address} and at ${heldAddress}`,
        );
      }
      const onPage = new Set<OwnedRef>();
      for (const entry of page.changes) {
        const { note } = entry;
        requireAuthor(note.ref, author);
        if (!isInSubtree(page.root_address, note.address)) {
          throw new UnaskedAnswerError(`a note at ${note.address}`);
        }
        if (held.has(note.ref) || onPage.has(note.ref)) {
          throw new UnaskedAnswerError(`${note.ref} twice`);
        }
        onPage.add(note.ref);
        if (entry.change === "changed" && entry.before.ref !== note.ref) {
          throw new UnaskedAnswerError(
            `${note.ref} compared against ${entry.before.ref}`,
          );
        }
        for (const held of entry.change === "removed" ? [] : entry.sections) {
          requireAuthor(held.section.ref, author);
          if (held.section.node !== note.ref) {
            throw new UnaskedAnswerError(`a section of ${held.section.node}`);
          }
          if (
            held.change === "changed" &&
            held.before.ref !== held.section.ref
          ) {
            throw new UnaskedAnswerError(
              `${held.section.ref} compared against ${held.before.ref}`,
            );
          }
        }
      }
      heldAddress = page.root_address;
      pages += 1;
      for (const ref of onPage) held.add(ref);
      return page;
    },
  };
}

function requirePage(taken: number): void {
  if (taken === MAX_PUBLISHED_PAGES) {
    throw new UnaskedAnswerError(`more than ${MAX_PUBLISHED_PAGES} pages`);
  }
}

function requireAuthor(ref: OwnedRef, did: DidSyr): void {
  if (splitOwnedRef(ref).did !== did) {
    throw new UnaskedAnswerError(`${ref} among ${did}'s own`);
  }
}
