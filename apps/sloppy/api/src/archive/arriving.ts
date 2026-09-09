// An archive's notes as rows: the genealogy a vault leaves to be re-derived,
// put back — docs/ARCHITECTURE.md § "A graph on disk".

import {
  type Address,
  type Block,
  createOwnedRecordId,
  type DidSyr,
  type Node,
  type NodeAlias,
  nowIso,
  type OwnedRef,
  parseNode,
  type RetiredAddress,
  splitOwnedRef,
  TagsSchema,
  type Timestamp,
} from "@sloppy/types";
import type { VaultNote } from "@sloppy/vault";
import { orderKeyBetween } from "../block/fractional-index";
import { referencesOf } from "../block/references";

/** A note the archive carries, with what a reader re-derives put back. */
export interface PlacedNote extends VaultNote {
  /** The parent's and one more; a branch and an independent note are 1. */
  depth: number;
  /** The root of this note's tree; a root is its own origin. */
  origin: OwnedRef;
  /** Absent where the archive carries no parent for it, or none it holds. */
  parent?: OwnedRef;
}

/**
 * The arriving notes with their depth and origin worked out from the parent
 * chain. A parent the archive does not carry is not one: the note opens a
 * branch rather than hanging off something that is not there.
 */
export function placed(notes: readonly VaultNote[]): PlacedNote[] {
  const byRef = new Map(notes.map((note) => [note.ref, note]));
  type Place = { depth: number; origin: OwnedRef; parent?: OwnedRef };
  const settled = new Map<OwnedRef, Place>();

  const settle = (note: VaultNote, walking: ReadonlySet<OwnedRef>): Place => {
    const already = settled.get(note.ref);
    if (already) return already;
    const parent =
      note.parent === undefined || walking.has(note.parent)
        ? undefined
        : byRef.get(note.parent);
    const above = parent
      ? settle(parent, new Set([...walking, note.ref]))
      : undefined;
    const place: Place =
      above && parent
        ? { depth: above.depth + 1, origin: above.origin, parent: parent.ref }
        : { depth: 1, origin: note.ref };
    settled.set(note.ref, place);
    return place;
  };

  return notes.map((note) => {
    const { parent: _named, ...rest } = note;
    return { ...rest, ...settle(note, new Set([note.ref])) };
  });
}

/** What an import preserves of a note it is writing over: a person's styling
 *  and whether a peer already holds it are neither of them the archive's to
 *  say. */
export type Kept = Pick<
  Node,
  "created_at" | "published" | "appearance" | "graph"
>;

export interface ArrivingRows {
  nodes: Node[];
  blocks: Block[];
  aliases: NodeAlias[];
}

/**
 * The rows one graph's worth of arriving notes lands as. `held` is what the
 * graph already keeps at each of those refs, whose styling and publication
 * state ride through the write.
 */
export function rowsFor(
  did: DidSyr,
  graph: OwnedRef,
  notes: readonly PlacedNote[],
  held: ReadonlyMap<OwnedRef, Kept>,
  at: Timestamp = nowIso(),
): ArrivingRows {
  const rows: ArrivingRows = { nodes: [], blocks: [], aliases: [] };
  const spent = new Set<Address>(
    notes.flatMap((note) => (note.address ? [note.address] : [])),
  );
  for (const note of notes) {
    const keeping = held.get(note.ref);
    const sections = note.sections.map((section) => ({
      content: section.content,
    }));
    rows.nodes.push(
      parseNode({
        id: idFor("node", did, note.ref),
        created_by: did,
        graph,
        ...(note.address ? { address: note.address } : {}),
        depth: note.depth,
        ...(note.parent ? { parent: note.parent } : {}),
        origin: note.origin,
        title: note.title,
        tags: TagsSchema.catch([]).parse(note.tags),
        links: note.links,
        references: referencesOf(note.ref, sections),
        published: keeping?.published ?? false,
        ...(keeping?.appearance ? { appearance: keeping.appearance } : {}),
        created_at: note.created ?? keeping?.created_at ?? at,
        updated_at: note.updated ?? at,
      }),
    );
    let ord: string | null = null;
    for (const section of note.sections) {
      ord = orderKeyBetween(ord, null);
      rows.blocks.push({
        id: createOwnedRecordId("block", did, section.ulid),
        created_by: did,
        node: note.ref,
        ord,
        content: section.content,
        created_at: note.created ?? at,
        updated_at: note.updated ?? at,
      });
    }
    for (const address of note.aliases) {
      if (spent.has(address)) continue;
      spent.add(address);
      rows.aliases.push({
        id: createOwnedRecordId("node_alias", did),
        created_by: did,
        graph,
        ...(note.parent ? { parent: note.parent } : {}),
        address,
        note: note.ref,
        created_at: at,
        updated_at: at,
      });
    }
  }
  return rows;
}

/**
 * The addresses the notes an import writes over are taking with them: the ones
 * the archive does not bring back. An address a graph has spent is never
 * assigned again — AI.md § "The Genealogy Is the Protocol".
 */
export function retiring(
  did: DidSyr,
  graph: OwnedRef,
  going: readonly Node[],
  arriving: ReadonlySet<Address>,
  at: Timestamp = nowIso(),
): RetiredAddress[] {
  const rows: RetiredAddress[] = [];
  const written = new Set<Address>();
  for (const note of going) {
    const address = note.address;
    if (address === undefined || written.has(address)) continue;
    if (arriving.has(address)) continue;
    written.add(address);
    rows.push({
      id: createOwnedRecordId("retired_address", did),
      created_by: did,
      graph,
      ...(note.parent ? { parent: note.parent } : {}),
      address,
      created_at: at,
      updated_at: at,
    });
  }
  return rows;
}

function idFor(table: string, did: DidSyr, ref: OwnedRef) {
  return createOwnedRecordId(table, did, splitOwnedRef(ref).localId);
}
