// Where somebody says their graph is served, from either direction it is said
// in — docs/ARCHITECTURE.md § "Where a person's graph is".

import { z } from "zod";
import {
  OwnedEntitySchema,
  type Principal,
  PrincipalSchema,
} from "./common.js";
import { PeerOriginSchema } from "./federation.js";
import { UnaskedAnswerError } from "./published.js";

/**
 * Whose graph, and where they say it is served.
 *
 * No identifier names a place: a `did:syr` binds a key and a `mailto:` names a
 * mailbox, so this is a person's own statement about themselves rather than
 * anything read out of what they are called. It is theirs to move, and moving
 * is an edit of it.
 */
export const WhereaboutsSchema = z.object({
  principal: PrincipalSchema,
  /**
   * The instance they say answers for their graph. **An address somebody else
   * chose**, like every address a peer supplies: the shape bounds one spelling
   * of `scheme://host[:port]` and says nothing about what this deployment will
   * connect to. A caller that fetches one without going through
   * `api/src/media/remote-host.ts` has taken a stranger's word for where to
   * send this instance.
   */
  instance: PeerOriginSchema,
});
export type Whereabouts = z.infer<typeof WhereaboutsSchema>;

/** What the document below says it is. */
export const WHEREABOUTS_DOCUMENT = "sloppy-whereabouts@v1";

/**
 * The declaration as it is SERVED: by a domain its subject controls, or by an
 * instance answering out of the row below on their behalf. One document either
 * way, so a reader holds one shape whichever answered and which one did is the
 * resolver's business.
 *
 * It names its own subject, because the domain and the instance are both
 * somebody else's: {@link parseWhereabouts} is what holds one to the person it
 * was asked about, and a domain answering for several people serves a document
 * for each of them.
 */
export const WhereaboutsDocumentSchema = WhereaboutsSchema.extend({
  type: z.literal(WHEREABOUTS_DOCUMENT),
});
export type WhereaboutsDocument = z.infer<typeof WhereaboutsDocumentSchema>;

/**
 * Somebody's own declaration, written on the instance they signed in to and
 * served by it on their behalf — the way in for a person who controls no domain
 * at all.
 *
 * One row per person, so declaring again writes the one that is there, and
 * `created_by` is its SUBJECT: where a person is, is theirs to say, and nobody
 * writes anybody else's.
 */
export const DeclaredWhereaboutsSchema = OwnedEntitySchema.extend({
  instance: PeerOriginSchema,
});
export type DeclaredWhereabouts = z.infer<typeof DeclaredWhereaboutsSchema>;

/** The row said the way the document says it. */
export function whereaboutsOf(
  row: Pick<DeclaredWhereabouts, "created_by" | "instance">,
): Whereabouts {
  return { principal: row.created_by, instance: row.instance };
}

/** What a person sends to say where they are. Sending another moves them. */
export const SetWhereaboutsRequestSchema = z.object({
  instance: PeerOriginSchema,
});
export type SetWhereaboutsRequest = z.input<typeof SetWhereaboutsRequestSchema>;

/**
 * One declaration, held to the person it was asked about — the boundary
 * `parsePublishedIndex` is for a listing. A domain answers for every address at
 * it and an instance answers for whoever signed in there, so a document about
 * somebody else is an answer to a question nobody asked, and taking one would
 * let either of them send a reader after whoever they liked.
 */
export function parseWhereabouts(
  body: unknown,
  principal: Principal,
): Whereabouts {
  const read = WhereaboutsDocumentSchema.safeParse(body);
  if (!read.success) {
    throw new UnaskedAnswerError(
      "something that is not a declaration",
      read.error,
    );
  }
  if (read.data.principal !== principal) {
    throw new UnaskedAnswerError(`about ${read.data.principal}`);
  }
  return { principal: read.data.principal, instance: read.data.instance };
}
