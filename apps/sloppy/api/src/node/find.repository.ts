// The reads a person finds a note again by: the sections whose writing carries
// what they remember, of their own and of the copies they hold, the address
// they cite, and the notes they wrote into last.
// docs/ARCHITECTURE.md § "Data model".

import { Injectable } from "@nestjs/common";
import {
  type Address,
  AddressSchema,
  DidSyrSchema,
  graphRef,
  type OwnedRef,
  ownedRefFrom,
  OwnedRefSchema,
  RecordIdSchema,
  splitOwnedRef,
} from "@sloppy/types";
import { z } from "zod";
import { DbService } from "../db/db.service";
import type { SectionMatch } from "./search";

/**
 * How many sections one search reads. A person recognising the note they meant
 * stops long before the end of an answer, and a section's writing is what makes
 * reading one expensive.
 */
const SECTIONS_READ = 200;

/**
 * A section the store matched. `at` is `search::offsets`, keyed by the position
 * of the column within the index — the one column these indexes carry — and
 * absent where the store answered without offsets at all.
 */
const MatchSchema = z.object({
  node: OwnedRefSchema,
  text: z.string(),
  at: z
    .record(z.string(), z.array(z.object({ s: z.int().nonnegative() })))
    .nullish(),
});

/** What one address reaches: the note at it, and the notes it led to before
 *  they were carried away from it. A note can be in both, having been carried
 *  back to where it started. */
export interface AddressReach {
  at: OwnedRef[];
  carriedAway: OwnedRef[];
}

/** One note somebody holds a copy of, as a hit names it. */
export interface HeldNote {
  /** The note as its AUTHOR addresses it, which is what opens it. */
  source: OwnedRef;
  /** The label its author gave it, absent where they gave it none. */
  address?: Address;
  /** The author's graph, which is where that address is read. */
  graph: OwnedRef;
  title: string;
  /** When its author wrote it, which is what orders two held notes neither of
   *  which carries an address. */
  created_at?: string;
}

const HeldNoteSchema = z.object({
  source: OwnedRefSchema,
  address: AddressSchema.optional(),
  source_did: DidSyrSchema,
  source_graph: OwnedRefSchema.optional(),
  title: z.string().nullish(),
  created_at: z.string().nullish(),
});

@Injectable()
export class FindRepository {
  constructor(private readonly db: DbService) {}

  /** The caller's own sections whose writing carries `words`, among `notes`
   *  where they are named. A section that went with a deleted note is not among
   *  them. */
  writingMatches(
    did: string,
    words: string,
    notes?: readonly OwnedRef[],
  ): Promise<SectionMatch[]> {
    return this.matching(
      `SELECT node, text, search::offsets(1) AS at FROM block
         WHERE text @1@ $words AND created_by = $did AND deleted_at = NONE
           ${among(notes)}
         LIMIT $read`,
      { did, words, notes: notes && [...notes] },
    );
  }

  /**
   * The caller's own notes one address reaches: the note at it, and the note it
   * was moved away from, which it leads to for as long as that note is there.
   * Narrowed to `graph` where one is named, since an address is read inside one
   * graph and each of a person's graphs has its own.
   */
  async notesAddressed(
    did: string,
    address: Address,
    graph?: OwnedRef,
  ): Promise<AddressReach> {
    const inGraph = graph === undefined ? "" : "AND graph = $graph";
    const [at, left] = await this.db.handle.query<[unknown[], unknown[]]>(
      `SELECT VALUE id FROM node
         WHERE created_by = $did AND address = $address ${inGraph};
       SELECT VALUE note FROM node_alias
         WHERE created_by = $did AND address = $address ${inGraph};`,
      { did, address, graph },
    );
    return {
      at: at.map((row) => ownedRefFrom(RecordIdSchema.parse(row))),
      carriedAway: left.map((row) => OwnedRefSchema.parse(row)),
    };
  }

  /** The same over what a peer handed them, so a search reaches a note they are
   *  holding and reading. */
  heldWritingMatches(
    did: string,
    words: string,
    notes?: readonly OwnedRef[],
  ): Promise<SectionMatch[]> {
    return this.matching(
      `SELECT node, text, search::offsets(1) AS at FROM pulled_block
         WHERE text @1@ $words AND created_by = $did
           ${among(notes)}
         LIMIT $read`,
      { did, words, notes: notes && [...notes] },
    );
  }

  /** The copies they hold that are read in `graph`. A held note's graph is its
   *  author's, which is where its address is read. */
  async heldNotesIn(did: string, graph: OwnedRef): Promise<OwnedRef[]> {
    const { did: author } = splitOwnedRef(graph);
    const [rows] = await this.db.handle.query<[unknown[]]>(
      `SELECT VALUE source FROM pulled_node
         WHERE created_by = $did AND source_did = $author
           AND source_graph = $graph`,
      { did, author, graph },
    );
    return rows.map((row) => OwnedRefSchema.parse(row));
  }

  /** How a hit names the held notes those sections belong to. */
  async heldNotes(
    did: string,
    sources: readonly OwnedRef[],
  ): Promise<HeldNote[]> {
    if (sources.length === 0) return [];
    const [rows] = await this.db.handle.query<[unknown[]]>(
      `SELECT source, address, source_did, source_graph, node.title AS title,
              node.created_at AS created_at
         FROM pulled_node
         WHERE created_by = $did AND source IN $sources`,
      { did, sources: [...sources] },
    );
    return rows.map((row) => {
      const held = HeldNoteSchema.parse(row);
      return {
        source: held.source,
        ...(held.address === undefined ? {} : { address: held.address }),
        graph: graphRef(held.source_did, held.source_graph),
        title: held.title ?? "",
        ...(held.created_at ? { created_at: held.created_at } : {}),
      };
    });
  }

  /**
   * The notes of theirs that have been written into, the most recently written
   * first — at most `limit` where one is named, and among `notes` where they
   * are named, one entry per note either way.
   *
   * The order is the SECTIONS', not the note rows': `node.updated_at` moves for
   * a title, a tag or a look, so a note somebody spent an afternoon writing into
   * would read as untouched since the day they made it.
   */
  async lastWritten(
    did: string,
    limit?: number,
    notes?: readonly OwnedRef[],
  ): Promise<OwnedRef[]> {
    const bound = limit === undefined ? "" : " LIMIT $limit";
    const [rows] = await this.db.handle.query<[{ node: unknown }[]]>(
      `SELECT node, array::max(array::group(updated_at)) AS at FROM block
         WHERE created_by = $did AND deleted_at = NONE ${among(notes)}
         GROUP BY node ORDER BY at DESC${bound}`,
      { did, limit, notes: notes && [...notes] },
    );
    return rows.map((row) => OwnedRefSchema.parse(row.node));
  }

  private async matching(
    sql: string,
    vars: Record<string, unknown>,
  ): Promise<SectionMatch[]> {
    const [rows] = await this.db.handle.query<[unknown[]]>(sql, {
      ...vars,
      read: SECTIONS_READ,
    });
    return rows.map((row) => {
      const found = MatchSchema.parse(row);
      return {
        note: found.node,
        text: found.text,
        at: Object.values(found.at ?? {})
          .flat()
          .map((one) => one.s)
          .sort((a, b) => a - b),
      };
    });
  }
}

/** Absent narrows nothing; an empty run narrows to nothing. */
function among(notes?: readonly OwnedRef[]): string {
  return notes === undefined ? "" : "AND node IN $notes";
}
