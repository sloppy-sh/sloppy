// An archive's notes as rows: the genealogy a vault leaves to be re-derived,
// put back — docs/ARCHITECTURE.md § "A graph on disk".

import {
  type Address,
  type Amendment,
  AmendmentSchema,
  type Block,
  createOwnedRecordId,
  type DidSyr,
  type Node,
  type NodeAlias,
  nowIso,
  type OwnedRef,
  ownedRefFrom,
  parseNode,
  type RetiredAddress,
  splitOwnedRef,
  TagsSchema,
  type Timestamp,
} from "@sloppy/types";
import type { VaultAmendment, VaultNote } from "@sloppy/vault";
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

/** One offered change as the archive carries it: the file's own name is its
 *  ULID, and the graph it is read in is whose the offer's reference is. */
export interface ArrivingAmendment extends VaultAmendment {
  ulid: string;
}

/**
 * The offers the archive brings, as rows under the identity taking them in.
 * One whose note the archive does not carry is dropped: an offer with no note
 * under it is nothing anybody can settle.
 *
 * `by` is never re-keyed — an offer is somebody's writing, and carrying a graph
 * somewhere else does not make it somebody else's.
 */
export function offeredRows(
  did: DidSyr,
  offers: readonly ArrivingAmendment[],
  notes: ReadonlySet<OwnedRef>,
  at: Timestamp = nowIso(),
): Amendment[] {
  const rows: Amendment[] = [];
  const standing = new Set<string>();
  for (const offer of offers) {
    if (!notes.has(offer.amends)) continue;
    // The store holds one offer per person per note; a folder somebody edited
    // by hand can say otherwise, and the first of them is the one that lands.
    const place = offeredOn(offer.amends, offer.by);
    if (standing.has(place)) continue;
    standing.add(place);
    rows.push(
      AmendmentSchema.parse({
        id: createOwnedRecordId("amendment", did, offer.ulid),
        created_by: did,
        note: offer.amends,
        by: offer.by,
        at: offer.at ?? at,
        ...(offer.message === undefined ? {} : { message: offer.message }),
        title: offer.title,
        tags: TagsSchema.catch([]).parse(offer.tags),
        ...(offer.appearance ? { appearance: offer.appearance } : {}),
        blocks: offer.sections.map((section) => ({
          ref: ownedRefFrom(createOwnedRecordId("block", did, section.ulid)),
          content: section.content,
        })),
        created_at: at,
        updated_at: at,
      }),
    );
  }
  return rows;
}

/** The one offer a person has standing on a note, as a key. */
export function offeredOn(note: OwnedRef, by: DidSyr): string {
  return `${note}\u0000${by}`;
}

/** Every address these notes lead by: the one each is at, and the ones each was
 *  carried away from. */
export function addressesLedBy(notes: readonly VaultNote[]): Set<Address> {
  const led = new Set<Address>();
  for (const note of notes) {
    if (note.address !== undefined) led.add(note.address);
    for (const alias of note.aliases) led.add(alias);
  }
  return led;
}

/**
 * The addresses the notes an import writes over are taking with them: the ones
 * they were at, the ones they were carried away from, and neither where the
 * archive brings that address back. Each row names the note that spent it, so
 * that note taking its own number back is the one thing the graph still allows
 * — AI.md § "The Genealogy Is the Protocol".
 */
export function retiring(
  did: DidSyr,
  graph: OwnedRef,
  going: readonly Node[],
  leaving: readonly NodeAlias[],
  arriving: ReadonlySet<Address>,
  at: Timestamp = nowIso(),
): RetiredAddress[] {
  const spent: { address: Address; parent?: OwnedRef; note: OwnedRef }[] = [
    ...going.flatMap((note) =>
      note.address === undefined
        ? []
        : [
            {
              address: note.address,
              parent: note.parent,
              note: ownedRefFrom(note.id),
            },
          ],
    ),
    ...leaving.map((alias) => ({
      address: alias.address,
      parent: alias.parent,
      note: alias.note,
    })),
  ];
  const rows: RetiredAddress[] = [];
  const written = new Set<Address>();
  for (const { address, parent, note } of spent) {
    if (written.has(address) || arriving.has(address)) continue;
    written.add(address);
    rows.push({
      id: createOwnedRecordId("retired_address", did),
      created_by: did,
      graph,
      ...(parent ? { parent } : {}),
      address,
      note,
      created_at: at,
      updated_at: at,
    });
  }
  return rows;
}

/** The graph a merge is landing in, as it stands before anything is written. */
export interface GraphNow {
  /** The notes whose rows the merge writes whatever else it finds: the ones
   *  arriving, and the ones settled between the two copies. */
  arriving: ReadonlySet<OwnedRef>;
  /** Every note the graph holds, the ones in the bin included. */
  held: readonly Node[];
  aliases: readonly NodeAlias[];
  retired: readonly RetiredAddress[];
  /** What is standing offered on the notes it holds. */
  offers: readonly Amendment[];
}

/** A merge as the rows it lands as: the notes it settles and the numbers it
 *  moves, with everything it does not name left where it is. */
export interface MergeWrite {
  /** The notes whose rows and sections this write replaces. */
  writing: OwnedRef[];
  nodes: Node[];
  blocks: Block[];
  aliases: NodeAlias[];
  /** The addresses that stop leading back, because the note they led to is at
   *  them again. */
  dropping: Address[];
  /** Notes in the bin giving up a number a settled note is taking. */
  yielding: OwnedRef[];
  /** The offers the archive brings. */
  amendments: Amendment[];
  /** The offers already standing that these arrive in place of: one person has
   *  one offer on a note, whichever file it arrived in. */
  unsettling: OwnedRef[];
}

/** What a settled merge still cannot be written as. */
export type MergeRefusal =
  | { what: "twice"; address: Address; notes: PlacedNote[] }
  | { what: "spent"; address: Address; note: PlacedNote }
  | { what: "led"; address: Address; note: PlacedNote; to: PlacedNote };

/**
 * The first thing a settlement leaves the graph unable to hold, or absent where
 * it can be written: two notes at one number, a number this graph spent on a
 * note other than the one arriving at it, and a number that still leads back to
 * another note the graph keeps while nobody stands at it, which is a citation
 * this merge would be the one to take away — AI.md § "The Genealogy Is the
 * Protocol".
 */
export function mergeRefusal(
  notes: readonly PlacedNote[],
  now: GraphNow,
): MergeRefusal | undefined {
  const at = new Map<Address, PlacedNote>();
  for (const note of notes) {
    if (note.address === undefined) continue;
    const other = at.get(note.address);
    if (other) {
      return { what: "twice", address: note.address, notes: [other, note] };
    }
    at.set(note.address, note);
  }
  for (const [address, note] of at) {
    const spent = now.retired.filter((row) => row.address === address);
    if (spent.length > 0 && !spent.some((row) => row.note === note.ref)) {
      return { what: "spent", address, note };
    }
  }
  const byRef = new Map(notes.map((one) => [one.ref, one]));
  const stoodAt = new Set(
    now.held.flatMap((row) =>
      row.deleted_at === undefined && row.address !== undefined
        ? [row.address]
        : [],
    ),
  );
  for (const [address, note] of at) {
    if (stoodAt.has(address)) continue;
    for (const alias of now.aliases) {
      if (alias.address !== address || alias.note === note.ref) continue;
      const to = byRef.get(alias.note);
      if (to) return { what: "led", address, note, to };
    }
  }
  return undefined;
}

/**
 * The rows a merge lands as. A note the merge settles or brings is written;
 * every other note the graph keeps is written only where the merge moved it,
 * took its number or put something above it, and left alone otherwise.
 */
export function mergeRows(
  did: DidSyr,
  graph: OwnedRef,
  notes: readonly PlacedNote[],
  now: GraphNow,
  offers: readonly ArrivingAmendment[] = [],
  at: Timestamp = nowIso(),
): MergeWrite {
  const held = new Map<OwnedRef, Node>(
    now.held.map((note) => [ownedRefFrom(note.id), note]),
  );
  const writing = notes.filter(
    (note) => now.arriving.has(note.ref) || rewritten(note, held.get(note.ref)),
  );
  const written = new Set(writing.map((note) => note.ref));
  const numbered = new Map<Address, OwnedRef>();
  for (const note of notes) {
    if (note.address !== undefined) numbered.set(note.address, note.ref);
  }
  const rows = rowsFor(did, graph, writing, held, at);
  const dropping = new Set(
    now.aliases
      .filter((alias) => numbered.get(alias.address) === alias.note)
      .map((alias) => alias.address),
  );
  const led = new Set(
    now.aliases
      .filter((alias) => !dropping.has(alias.address))
      .map((alias) => alias.address),
  );
  const aliases: NodeAlias[] = [];
  const lead = (address: Address, note: OwnedRef, parent?: OwnedRef): void => {
    if (led.has(address)) return;
    led.add(address);
    aliases.push({
      id: createOwnedRecordId("node_alias", did),
      created_by: did,
      graph,
      ...(parent ? { parent } : {}),
      address,
      note,
      created_at: at,
      updated_at: at,
    });
  };
  for (const note of notes) {
    for (const address of note.aliases) {
      if (address !== note.address) lead(address, note.ref, note.parent);
    }
  }
  const yielding = now.held.filter(
    (note) =>
      note.deleted_at !== undefined &&
      note.address !== undefined &&
      numbered.has(note.address) &&
      numbered.get(note.address) !== ownedRefFrom(note.id) &&
      !written.has(ownedRefFrom(note.id)),
  );
  for (const note of yielding) {
    lead(note.address as Address, ownedRefFrom(note.id), note.parent);
  }
  const amendments = offeredRows(
    did,
    offers,
    new Set(notes.map((note) => note.ref)),
    at,
  );
  const offering = new Set(
    amendments.map((row) => offeredOn(row.note, row.by)),
  );
  return {
    writing: [...written],
    nodes: rows.nodes,
    blocks: rows.blocks,
    aliases,
    dropping: [...dropping],
    yielding: yielding.map((note) => ownedRefFrom(note.id)),
    amendments,
    unsettling: now.offers
      .filter((row) => offering.has(offeredOn(row.note, row.by)))
      .map((row) => ownedRefFrom(row.id)),
  };
}

/** Whether the row this graph holds still says what the merge does about where
 *  the note is and what it is numbered. */
function rewritten(note: PlacedNote, row: Node | undefined): boolean {
  return (
    row === undefined ||
    row.deleted_at !== undefined ||
    row.depth !== note.depth ||
    row.origin !== note.origin ||
    row.parent !== note.parent ||
    row.address !== note.address
  );
}

/** Two files an archive holds that would land as one row. */
export interface Repeat {
  what: "note" | "address" | "section";
  /** The number two notes are both at, where that is what repeats. */
  address?: Address;
  /** Where it is: one note where a note repeats a section of its own. */
  notes: VaultNote[];
}

/**
 * The first thing an archive says twice, or absent where it says everything
 * once. A vault is a folder a person edits, so one of these is an ordinary
 * mistake rather than a broken file, and each would land as a row written over
 * another.
 */
export function repeated(notes: readonly VaultNote[]): Repeat | undefined {
  const refs = new Map<OwnedRef, VaultNote>();
  const addresses = new Map<Address, VaultNote>();
  const sections = new Map<string, VaultNote>();
  for (const note of notes) {
    const sameNote = refs.get(note.ref);
    if (sameNote) return { what: "note", notes: [sameNote, note] };
    refs.set(note.ref, note);
    if (note.address !== undefined) {
      const sameAddress = addresses.get(note.address);
      if (sameAddress) {
        return {
          what: "address",
          address: note.address,
          notes: [sameAddress, note],
        };
      }
      addresses.set(note.address, note);
    }
    for (const section of note.sections) {
      const holder = sections.get(section.ulid);
      if (holder) {
        return {
          what: "section",
          notes: holder === note ? [note] : [holder, note],
        };
      }
      sections.set(section.ulid, note);
    }
  }
  return undefined;
}

function idFor(table: string, did: DidSyr, ref: OwnedRef) {
  return createOwnedRecordId(table, did, splitOwnedRef(ref).localId);
}
