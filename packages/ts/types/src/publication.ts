// Publishing a subtree, and the shape a peer pulls it back in.
//
// Federation is pull-only, so this is a read contract rather than a delivery
// one: a publication row says a subtree may be read, and a peer that follows
// the DID fetches it whenever it likes. See docs/ARCHITECTURE.md § "Federating
// the graph".

import { z } from "zod";
import { type Address, AddressSchema, isInSubtree } from "./address.js";
import { splitOwnedRef } from "./codecs.js";
import { BlockDocumentSchema } from "./document.js";
import {
  type DidSyr,
  DidSyrSchema,
  OwnedEntitySchema,
  type OwnedRef,
  OwnedRefSchema,
  TimestampSchema,
} from "./common.js";
import { TagsSchema } from "./tag.js";

/**
 * A subtree its author has made readable. The row existing is what makes it
 * readable, so unpublishing deletes the row — and a peer who already pulled the
 * subtree keeps their copy, which is a fact the product states plainly rather
 * than a gap.
 */
export const PublicationSchema = OwnedEntitySchema.extend({
  root: OwnedRefSchema,
  /** The address a peer cites, denormalized so a public read needs no join. */
  root_address: AddressSchema,
});
export type Publication = z.infer<typeof PublicationSchema>;

export const CreatePublicationRequestSchema = z.object({
  root: OwnedRefSchema,
});
export type CreatePublicationRequest = z.input<
  typeof CreatePublicationRequestSchema
>;

/**
 * The public duplicate of a picture inside a published note, and the row that
 * remembers which picture it is a copy of. Publishing copies the bytes rather
 * than widening the original, so the same picture in a note nobody published
 * stays private; docs/ARCHITECTURE.md § "Pictures" carries the ruling.
 *
 * `created_by` is the AUTHOR: both uploads are theirs, and the copy is theirs
 * to delete.
 */
export const PublishedPictureSchema = OwnedEntitySchema.extend({
  /** The picture as the author's own note cites it. Private, and stays so. */
  source_upload: z.string().min(1),
  /** The copy a peer reads, and the one a published note cites. */
  public_upload: z.string().min(1),
});
export type PublishedPicture = z.infer<typeof PublishedPictureSchema>;

/**
 * How much of somebody else's graph ONE ANSWER may carry, and how many answers
 * a reader takes before it stops asking.
 *
 * A pull is an OUTBOUND fetch, so nothing about the reader's own request bounds
 * it: what arrives is whatever the author's instance chose to send, and the
 * reader's instance parses all of it and writes a row per node and per block. A
 * page past one of these is refused whole; a subtree longer than a page carries
 * a cursor instead, so what bounds a region is the product of the two rather
 * than a size a graph can outgrow.
 */
export const MAX_PUBLISHED_ROOTS_PER_PAGE = 500;
export const MAX_PUBLISHED_NODES_PER_PAGE = 2_000;
export const MAX_PUBLISHED_BLOCKS_PER_PAGE = 10_000;
export const MAX_PUBLISHED_PAGES = 128;

/**
 * Where the answer resumes. Minted by the instance that served the page and
 * handed back to it untouched — what it means is that instance's own, so
 * nothing here reads one.
 */
export const PageCursorSchema = z.string().min(1).max(512);
export type PageCursor = z.infer<typeof PageCursorSchema>;

/**
 * One subtree an identity publishes, as an instance lists it: enough to choose
 * one and pull it, and nothing that is not already public in it.
 */
export const PublishedRootSchema = z.object({
  root_address: AddressSchema,
  title: z.string().max(512),
  /** When the author last published or republished it. */
  updated_at: TimestampSchema,
});
export type PublishedRoot = z.infer<typeof PublishedRootSchema>;

/**
 * One page of what an identity publishes on one instance — the answer to "I
 * follow this person, what can I read?", which a DID alone cannot give: nothing
 * in syr's identity manifest names where somebody's graph is served, so the
 * instance is asked and never derived. docs/ARCHITECTURE.md § "Federating the
 * graph".
 *
 * A page stands on its own: one entry is one region, and nothing in it refers
 * to an entry on another page.
 */
export const PublishedIndexSchema = z.object({
  did: DidSyrSchema,
  roots: z.array(PublishedRootSchema).max(MAX_PUBLISHED_ROOTS_PER_PAGE),
  /** Absent on the last page. */
  next_cursor: PageCursorSchema.optional(),
});
export type PublishedIndex = z.infer<typeof PublishedIndexSchema>;

/**
 * One node as a peer receives it. Rows travel by `<did>/<ulid>` reference
 * rather than by record id, and carry no `depth`: a reader computes it, the
 * sector, and which addresses lie under which, from the address.
 *
 * **Every reference on it names a note the caller may read**, because this
 * whole shape reaches an anonymous one. A `<did>/<ulid>` is not readable by
 * itself, but it says a note exists and when it was written; the three fields
 * below each carry the rule that keeps one out.
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
  /** Only targets the same author publishes. A link to a note nobody published
   *  is dropped rather than named. */
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
 * One block as a peer receives it. A picture in `content` is cited by the
 * PUBLIC copy of its upload and never by the private original the author's own
 * note reads, so what a peer holds is an address that answers for them;
 * docs/ARCHITECTURE.md § "Pictures" is the ruling and who does the swap.
 */
export const PublishedBlockSchema = z.object({
  ref: OwnedRefSchema,
  node: OwnedRefSchema,
  ord: z.string(),
  content: BlockDocumentSchema,
});
export type PublishedBlock = z.infer<typeof PublishedBlockSchema>;

/** One answer from a peer's public endpoint. */
export const PublishedSubtreePageSchema = z.object({
  did: DidSyrSchema,
  root_address: AddressSchema,
  nodes: z.array(PublishedNodeSchema).max(MAX_PUBLISHED_NODES_PER_PAGE),
  blocks: z.array(PublishedBlockSchema).max(MAX_PUBLISHED_BLOCKS_PER_PAGE),
  /** Absent on the last page. */
  next_cursor: PageCursorSchema.optional(),
});
export type PublishedSubtreePage = z.infer<typeof PublishedSubtreePageSchema>;

/** Every page of one subtree, assembled: what a caller holds once the last page
 *  is in. The wire carries pages, so nothing parses this. */
export interface PublishedSubtree {
  did: DidSyr;
  root_address: Address;
  nodes: PublishedNode[];
  blocks: PublishedBlock[];
}

/** An answer from a peer that is not the answer that was asked for. */
export class UnaskedAnswerError extends Error {
  constructor(reason: string, cause?: unknown) {
    super(`A peer answered with ${reason}`, { cause });
    this.name = "UnaskedAnswerError";
  }
}

/** A peer's listing, held to the identity it was asked about. */
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
  return read.data;
}

/**
 * Reads one peer's subtree, holding every page to what was asked for and to the
 * pages already taken: a note's parent may have arrived on an earlier one, and
 * a note may not claim an address another already has, on this page or any
 * before it — the same rule `node_owner_address UNIQUE` holds our own rows to,
 * on rows a peer handed us.
 */
export interface PublishedSubtreeReader {
  /**
   * One answer. A page is taken WHOLE or refused whole — what gets past is
   * written into the reader's own store under the author's name — and a refused
   * page leaves the reader holding exactly what it held before. `next_cursor`
   * on what comes back is the page to ask for next.
   */
  take(body: unknown): PublishedSubtreePage;
  /** Every note this region has served, which is what a refresh sweeps against
   *  once the last page is in. docs/ARCHITECTURE.md § "Federating the graph". */
  served(): Set<OwnedRef>;
}

export function publishedSubtreeReader(asked: {
  did: DidSyr;
  root_address: Address;
}): PublishedSubtreeReader {
  const heldNodes = new Set<OwnedRef>();
  const heldAddresses = new Set<Address>();
  const heldBlocks = new Set<OwnedRef>();
  let regionRoot: OwnedRef | undefined;
  let pages = 0;

  return {
    take(body: unknown): PublishedSubtreePage {
      if (pages === MAX_PUBLISHED_PAGES) {
        throw new UnaskedAnswerError(`more than ${MAX_PUBLISHED_PAGES} pages`);
      }
      const read = PublishedSubtreePageSchema.safeParse(body);
      if (!read.success) {
        throw new UnaskedAnswerError(
          "something that is not a subtree",
          read.error,
        );
      }
      const page = read.data;
      if (page.did !== asked.did) {
        throw new UnaskedAnswerError(`${asked.did}'s subtree as ${page.did}`);
      }
      if (page.root_address !== asked.root_address) {
        throw new UnaskedAnswerError(`the subtree at ${page.root_address}`);
      }
      const root =
        regionRoot ??
        page.nodes.find((n) => n.address === asked.root_address)?.ref;
      if (root === undefined) {
        throw new UnaskedAnswerError("a subtree without its own root");
      }

      const pageNodes = new Set<OwnedRef>();
      const pageAddresses = new Set<Address>();
      for (const node of page.nodes) {
        requireAuthor(node.ref, asked.did);
        if (!isInSubtree(asked.root_address, node.address)) {
          throw new UnaskedAnswerError(`a note at ${node.address}`);
        }
        if (heldNodes.has(node.ref) || pageNodes.has(node.ref)) {
          throw new UnaskedAnswerError(`${node.ref} twice`);
        }
        if (
          heldAddresses.has(node.address) ||
          pageAddresses.has(node.address)
        ) {
          throw new UnaskedAnswerError(`a second note at ${node.address}`);
        }
        pageNodes.add(node.ref);
        pageAddresses.add(node.address);
      }
      for (const node of page.nodes) {
        if (node.origin !== root) {
          throw new UnaskedAnswerError(`a note rooted at ${node.origin}`);
        }
        if (node.address === asked.root_address) {
          if (node.parent !== undefined) {
            throw new UnaskedAnswerError("a root pointing outside the subtree");
          }
        } else if (node.parent === undefined) {
          throw new UnaskedAnswerError(
            `a note at ${node.address} with nothing above it`,
          );
        } else if (!heldNodes.has(node.parent) && !pageNodes.has(node.parent)) {
          throw new UnaskedAnswerError(`a note referring to ${node.parent}`);
        }
      }

      const pageBlocks = new Set<OwnedRef>();
      for (const block of page.blocks) {
        requireAuthor(block.ref, asked.did);
        if (heldBlocks.has(block.ref) || pageBlocks.has(block.ref)) {
          throw new UnaskedAnswerError(`${block.ref} twice`);
        }
        if (!heldNodes.has(block.node) && !pageNodes.has(block.node)) {
          throw new UnaskedAnswerError(`a section of ${block.node}`);
        }
        pageBlocks.add(block.ref);
      }

      regionRoot = root;
      pages += 1;
      for (const ref of pageNodes) heldNodes.add(ref);
      for (const address of pageAddresses) heldAddresses.add(address);
      for (const ref of pageBlocks) heldBlocks.add(ref);
      return page;
    },

    served(): Set<OwnedRef> {
      return new Set(heldNodes);
    },
  };
}

function requireAuthor(ref: OwnedRef, did: DidSyr): void {
  if (splitOwnedRef(ref).did !== did) {
    throw new UnaskedAnswerError(`${ref} among ${did}'s own`);
  }
}
