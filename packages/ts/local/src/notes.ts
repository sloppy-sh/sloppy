// Writing a note into a graph on this device, and the one thing about it that
// is a protocol rather than a feature: the address. AI.md § "The Genealogy Is
// the Protocol", and the same functions from `@sloppy/types` the server runs.

import {
  type Address,
  type CreateNodeRequest,
  CreateNodeRequestSchema,
  type NodeBulkRequest,
  NodeBulkRequestSchema,
  type NodeBulkResult,
  type NodeView,
  type NoteDestination,
  type OwnedRef,
  type Tags,
  TagsSchema,
  type UpdateNodeRequest,
  UpdateNodeRequestSchema,
  MAX_TAGS_PER_NODE,
  graphAsked,
  isAncestorAddress,
  isRootAddress,
  namesGraph,
  nextChildAddress,
  nowIso,
  noteLabel,
  parentAddress,
  rebaseAddress,
  ulid,
} from "@sloppy/types";
import type { LocalGraph, StoredNote } from "./graph.js";
import { absent, checked, refuse } from "./refusal.js";

/**
 * How many addresses the rule may pass over before it refuses in words. A
 * person's own label sits wherever they wrote it, so the run can have a hole in
 * it; the bound is what stops a pathological loop, not a tuned number.
 */
const ADDRESS_ATTEMPTS = 32;

/** Where a new note goes: the note it hangs under, `null` for a branch. */
type Landing = StoredNote | null;

export class NoteWriter {
  constructor(private readonly graph: LocalGraph) {}

  async create(asked: CreateNodeRequest): Promise<NodeView> {
    const request = checked(() => CreateNodeRequestSchema.parse(asked));
    const from = request.from;
    if (from?.relation === "root" && request.address !== undefined) {
      throw refuse("Sloppy is out of date. Update it and try again.");
    }
    this.requireGraph(graphAsked(from));
    if (request.address !== undefined) {
      return this.writeNumbered(request, request.address);
    }
    if (from?.relation === "root") {
      return this.writeAt(request, from.address);
    }
    if (from?.relation === "free") {
      return this.put(this.newNote(null, request));
    }
    return this.write(request);
  }

  async update(ref: OwnedRef, asked: UpdateNodeRequest): Promise<NodeView> {
    const request = checked(() => UpdateNodeRequestSchema.parse(asked));
    const note = this.require(ref);
    return this.put({
      ...note,
      ...(request.title === undefined ? {} : { title: request.title }),
      ...(request.tags === undefined ? {} : { tags: [...request.tags] }),
      ...(request.links === undefined ? {} : { links: [...request.links] }),
      updated_at: nowIso(),
    });
  }

  /**
   * The label a person cites this note by, written or taken off. The address it
   * leaves keeps leading to it, and an address it has carried before is its own
   * to take back — AI.md § "The Genealogy Is the Protocol".
   */
  async setAddress(ref: OwnedRef, address: Address | null): Promise<NodeView> {
    const note = this.require(ref);
    const giving =
      address === null ? null : this.claim(address, new Set([ref]), ref);
    const leaving =
      note.address === undefined || note.address === address
        ? []
        : this.graph.keptBehind([note.address]);
    const { address: _was, ...rest } = note;
    await this.yieldTo(giving);
    return this.put({
      ...rest,
      ...(address === null ? {} : { address }),
      aliases: [...note.aliases, ...leaving].filter(
        (alias) => alias !== address,
      ),
      updated_at: nowIso(),
    });
  }

  /**
   * A note carried somewhere else, with everything that sprang from it. The
   * answer is that subtree as it now stands, because a move can re-address all
   * of it.
   */
  async move(
    ref: OwnedRef,
    to: NoteDestination,
    address?: Address,
  ): Promise<NodeView[]> {
    const note = this.require(ref);
    const carried = this.carried(note);
    const landing = this.landingFor(note, to, carried);
    return address === undefined
      ? this.carry(note, carried, landing)
      : this.carryTo(note, carried, landing, address);
  }

  /** A note goes with everything that sprang from it, and can be put back until
   *  the bin's window closes. */
  async remove(ref: OwnedRef): Promise<void> {
    await this.graph.sweep();
    const note = this.graph.find(ref);
    if (!note) return;
    await this.graph.bin(
      this.carried(note).filter((one) => one.deleted_at === undefined),
      nowIso(),
    );
  }

  /** One out of the bin, where it was, with the address it still holds. */
  async restore(ref: OwnedRef): Promise<NodeView> {
    await this.graph.sweep();
    const gone = this.graph.findDeleted(ref);
    if (!gone) throw absent("That branch is not here to put back.");
    if (gone.parent !== undefined && this.graph.findDeleted(gone.parent)) {
      throw refuse("Put the branch above this one back first.");
    }
    const going = this.carried(gone).filter(
      (one) => one.deleted_at === gone.deleted_at,
    );
    let back = gone;
    for (const one of going) {
      const put = await this.graph.restore(one);
      if (put.ref === ref) back = put;
    }
    return this.graph.view(back);
  }

  /** One act, over however many notes somebody chose. A note that has gone
   *  since their graph was drawn is counted rather than treated as a failure. */
  async bulk(asked: NodeBulkRequest): Promise<NodeBulkResult> {
    const request = checked(() => NodeBulkRequestSchema.parse(asked));
    const act = request.act;
    const wanted = [...new Set(request.notes)];
    const mine = wanted.flatMap((ref) => {
      const held = this.graph.find(ref);
      return held ? [held] : [];
    });
    if (mine.length === 0) {
      throw absent(
        "None of those notes are here any more. Reload your graph and try again.",
      );
    }
    if (act.act === "publish") {
      throw refuse(
        "Publishing needs a hosted Sloppy. This graph is on your device.",
      );
    }
    if (act.act === "set_appearance") {
      throw refuse("A note's look is not kept in a graph on your device yet.");
    }
    if (act.act === "delete") {
      await this.graph.sweep();
      const going = new Map<OwnedRef, StoredNote>();
      for (const note of mine) {
        for (const kin of this.carried(note)) {
          if (kin.deleted_at === undefined) going.set(kin.ref, kin);
        }
      }
      await this.graph.bin([...going.values()], nowIso());
      return {
        reached: mine.length,
        missed: wanted.length - mine.length,
        notes: [],
      };
    }
    const written: NodeView[] = [];
    for (const note of mine) {
      written.push(await this.put(this.acted(note, act)));
    }
    return {
      reached: written.length,
      missed: wanted.length - written.length,
      notes: written,
    };
  }

  // ── Placing ──────────────────────────────────────────────────────────────

  private require(ref: OwnedRef): StoredNote {
    const note = this.graph.find(ref);
    if (!note) throw absent("That note is not here.");
    return note;
  }

  private requireGraph(named: OwnedRef | undefined): void {
    if (named !== undefined && named !== this.graph.ref) {
      throw refuse("That graph is not open on this device.");
    }
  }

  /** Where a new note goes. A note placed `after` another takes that note's
   *  parent, which is what makes `1a` → `1b` and `1` → `2` the same act at two
   *  depths. */
  private placeFor(from: CreateNodeRequest["from"]): Landing {
    if (!from || namesGraph(from)) return null;
    const anchor = this.graph.find(from.note);
    if (!anchor) {
      throw refuse(
        from.relation === "under"
          ? "The note this springs from is not here."
          : "The note this follows is not here.",
      );
    }
    if (from.relation === "under") return anchor;
    if (anchor.parent === undefined) return null;
    const parent = this.graph.find(anchor.parent);
    if (!parent) throw refuse("The note this follows is not here.");
    return parent;
  }

  private newNote(
    parent: Landing,
    request: { title: string; tags: Tags },
    address?: Address,
  ): StoredNote {
    const id = ulid();
    const at = nowIso();
    return {
      ref: `${this.graph.did}/${id}`,
      ulid: id,
      ...(parent ? { parent: parent.ref } : {}),
      ...(address === undefined ? {} : { address }),
      aliases: [],
      tags: [...request.tags],
      links: [],
      title: request.title,
      created_at: at,
      updated_at: at,
      sections: [],
    };
  }

  private async put(note: StoredNote): Promise<NodeView> {
    return this.graph.view(await this.graph.save(note));
  }

  /** A branch at the number its author picked, which nothing in that graph but
   *  a note in the bin may be holding. */
  private async writeAt(
    request: { title: string; tags: Tags },
    address: Address,
  ): Promise<NodeView> {
    await this.yieldTo(this.claimUnheld(address));
    return this.put(this.newNote(null, request, address));
  }

  /**
   * A note written at the address its author named rather than at the one the
   * rule offers. It springs from the address of the note it is written under,
   * or from nothing where it opens a branch.
   */
  private async writeNumbered(
    request: { from?: CreateNodeRequest["from"]; title: string; tags: Tags },
    address: Address,
  ): Promise<NodeView> {
    const parent = this.placeFor(request.from);
    const under = parent === null ? null : parent.address;
    if (under === undefined) {
      throw refuse(
        `${called(parent)} has no number, so a note springing from it can carry none either. Number that note first, or write this one without a number.`,
      );
    }
    if (impliedParent(address) !== under)
      throw springsElsewhere(address, under);
    await this.yieldTo(this.claimUnheld(address));
    return this.put(this.newNote(parent, request, address));
  }

  private async write(request: {
    from?: CreateNodeRequest["from"];
    title: string;
    tags: Tags;
  }): Promise<NodeView> {
    const parent = this.placeFor(request.from);
    if (parent !== null && parent.address === undefined) {
      return this.put(this.newNote(parent, request));
    }
    // The run read by parent cannot show a label its author wrote on a note
    // somewhere else in the graph, so the addresses that turn out to be spent
    // are fed back into it and the rule offers the next one.
    const passed: Address[] = [];
    for (let attempt = 1; ; attempt++) {
      const address = nextChildAddress(parent?.address ?? null, [
        ...this.graph.runUnder(parent),
        ...passed,
      ]);
      // A branch the rule numbers has to be one a person could have named, or
      // the branch after it would have no number left to take.
      if (parent === null && !isRootAddress(address)) {
        throw refuse(
          "There is no number left after your highest branch. Number a lower one.",
        );
      }
      if (this.graph.leadsTo(address) === undefined) {
        return this.put(this.newNote(parent, request, address));
      }
      if (attempt >= ADDRESS_ATTEMPTS) throw allSpent([...passed, address]);
      passed.push(address);
    }
  }

  // ── Claiming an address ──────────────────────────────────────────────────

  /**
   * The address made this note's to take, or refused in words where it leads
   * somewhere else in this graph. `mine` is the notes landing together, whose
   * hold on it one write replaces; `taking` is the one landing on it, and an
   * address a note was carried away from is that note's alone to take back.
   */
  private claim(
    address: Address,
    mine: ReadonlySet<OwnedRef>,
    taking: OwnedRef,
  ): StoredNote | null {
    const held = this.graph.leadsTo(address);
    if (held === undefined) return null;
    if (
      held.note !== undefined &&
      (held.hold === "moved" ? held.note === taking : mine.has(held.note))
    ) {
      return null;
    }
    return this.yieldedBy(address, held);
  }

  /** The same question asked for a note that does not exist yet, which no
   *  address in the graph can be leading to. */
  private claimUnheld(address: Address): StoredNote | null {
    const held = this.graph.leadsTo(address);
    return held === undefined ? null : this.yieldedBy(address, held);
  }

  /** Only a note in the bin gives its address up. */
  private yieldedBy(
    address: Address,
    held: { hold: "live" | "deleted" | "moved"; note?: OwnedRef },
  ): StoredNote | null {
    if (held.note === undefined) throw leadsNowhere(address);
    const there = this.graph.find(held.note);
    if (there) throw leadsTo(address, held.hold, there);
    const binned = this.graph.findDeleted(held.note);
    if (!binned) throw leadsTo(address, held.hold, null);
    if (binned.address !== address) return null;
    return binned;
  }

  /** The note in the bin letting the address go, and keeping a way back to
   *  itself where the graph does not already lead back by it. */
  private async yieldTo(giving: StoredNote | null): Promise<void> {
    if (!giving) return;
    const address = giving.address;
    const { address: _gone, ...rest } = giving;
    await this.graph.save({
      ...rest,
      aliases:
        address === undefined
          ? giving.aliases
          : [...giving.aliases, ...this.graph.keptBehind([address])],
    });
  }

  // ── Carrying a note ──────────────────────────────────────────────────────

  /** Everything a move takes with this note, the deleted ones among them: one
   *  left where it was would sit under an address no note is at. The root comes
   *  first. */
  private carried(root: StoredNote): StoredNote[] {
    const within = new Set<OwnedRef>([root.ref]);
    const held = this.graph.all();
    for (let grew = true; grew; ) {
      grew = false;
      for (const note of held) {
        if (within.has(note.ref) || note.parent === undefined) continue;
        if (within.has(note.parent)) {
          within.add(note.ref);
          grew = true;
        }
      }
    }
    return [
      root,
      ...held.filter((note) => note.ref !== root.ref && within.has(note.ref)),
    ];
  }

  /** The note a move hangs the carried one under, `null` where it becomes a
   *  branch of its own. Every refusal a move has is a destination it cannot
   *  take, so they are all here. */
  private landingFor(
    note: StoredNote,
    to: NoteDestination,
    carried: readonly StoredNote[],
  ): Landing {
    if (to.note === note.ref) {
      throw refuse("Carry this note to a different one.");
    }
    const anchor = this.graph.find(to.note);
    if (!anchor) throw refuse(missing(to.relation));
    const within = new Set(carried.map((one) => one.ref));
    if (to.relation === "under") return outside(within, anchor);
    if (anchor.parent === undefined) return null;
    const parent = this.graph.find(anchor.parent);
    if (!parent) throw refuse(missing(to.relation));
    return outside(within, parent);
  }

  private async carry(
    note: StoredNote,
    carried: readonly StoredNote[],
    parent: Landing,
  ): Promise<NodeView[]> {
    const beneath = carried.filter((one) => one.ref !== note.ref);
    const was = note.address;
    const reads =
      was === undefined || (parent !== null && parent.address === undefined)
        ? null
        : this.graph.runUnder(parent);
    // Where the subtree would land on a label its author wrote outside this
    // run, the whole of it moves along to the next address instead.
    const passed: Address[] = [];
    for (let attempt = 1; ; attempt++) {
      const landing =
        reads === null || was === undefined
          ? null
          : movedSubtree(
              parent?.address ?? null,
              [...reads, ...passed],
              was,
              beneath.flatMap((one) => (one.address ? [one.address] : [])),
            );
      const now =
        landing === null || was === undefined ? undefined : landing.get(was);
      if (parent === null && now !== undefined && !isRootAddress(now)) {
        throw refuse(
          "There is no number left after your highest branch. Carry this note under a note instead.",
        );
      }
      if (
        now !== undefined &&
        landing !== null &&
        this.graph.spent([...landing.values()]).size > 0
      ) {
        if (attempt >= ADDRESS_ATTEMPTS) throw allSpent([...passed, now]);
        passed.push(now);
        continue;
      }
      return this.land(note, parent, carried, landing, now);
    }
  }

  /** The same carry, landing on the address the person named rather than the
   *  one the rule offers. A label somebody wrote is never quietly moved to the
   *  next number for them. */
  private async carryTo(
    note: StoredNote,
    carried: readonly StoredNote[],
    parent: Landing,
    now: Address,
  ): Promise<NodeView[]> {
    const under = parent === null ? null : parent.address;
    if (under === undefined) {
      throw refuse(
        `${called(parent)} has no number, so a note springing from it can carry none either. Number that note first, or carry this one without a number.`,
      );
    }
    if (impliedParent(now) !== under) throw springsElsewhere(now, under);

    const was = note.address;
    const landing = new Map<Address, Address>();
    const taking = new Map<Address, OwnedRef>([[now, note.ref]]);
    if (was !== undefined) {
      landing.set(was, now);
      for (const one of carried) {
        if (one.address === undefined || !isAncestorAddress(was, one.address)) {
          continue;
        }
        const to = rebaseAddress(was, now, one.address);
        landing.set(one.address, to);
        taking.set(to, one.ref);
      }
    }
    const mine = new Set(carried.map((one) => one.ref));
    for (const [at, who] of taking) {
      await this.yieldTo(this.claim(at, mine, who));
    }
    return this.land(note, parent, carried, landing, now, true);
  }

  /** The carried subtree where it now sits, with each address it leaves behind
   *  still leading to the note that left it. */
  private async land(
    note: StoredNote,
    parent: Landing,
    carried: readonly StoredNote[],
    landing: Map<Address, Address> | null,
    now: Address | undefined,
    distinct = false,
  ): Promise<NodeView[]> {
    const at = new Map<OwnedRef, Address | undefined>([[note.ref, now]]);
    for (const one of carried) {
      if (one.ref === note.ref) continue;
      at.set(
        one.ref,
        one.address === undefined
          ? undefined
          : (landing?.get(one.address) ?? one.address),
      );
    }
    if (distinct) requireDistinct(at);
    const stamp = nowIso();
    const landed = carried.map((one) => {
      const address = at.get(one.ref);
      const leaving =
        one.address !== undefined && one.address !== address
          ? this.graph.keptBehind([one.address])
          : [];
      const { address: _left, parent: above, ...rest } = one;
      const hangs = one.ref === note.ref ? parent?.ref : above;
      return {
        ...rest,
        ...(address === undefined ? {} : { address }),
        ...(hangs === undefined ? {} : { parent: hangs }),
        aliases: [...one.aliases, ...leaving].filter(
          (alias) => alias !== address,
        ),
        updated_at: stamp,
      };
    });
    await this.graph.saveAll(landed);
    return landed
      .filter((one) => one.deleted_at === undefined)
      .map((one) => this.graph.view(one));
  }

  private acted(
    note: StoredNote,
    act: { act: "tag" | "untag"; tags: readonly string[] },
  ): StoredNote {
    const adding = act.act === "tag";
    const named = TagsSchema.parse([...act.tags]);
    const after = adding
      ? [...note.tags, ...named]
      : note.tags.filter((tag) => !named.includes(tag));
    const parsed = TagsSchema.safeParse(after);
    if (!parsed.success) {
      throw refuse(
        `A note carries at most ${MAX_TAGS_PER_NODE} tags, and ${noteLabel(note)} would go past that. Take a few off it first.`,
      );
    }
    return { ...note, tags: [...parsed.data], updated_at: nowIso() };
  }
}

/**
 * Where a moved note and everything beneath it land: the address each one is at
 * now, mapped to the address it takes. A note beneath whose label its author
 * wrote from outside the moved note's run is absent from the answer — it is
 * that person's label, and a move of the note above it is not them changing it.
 */
export function movedSubtree(
  parent: Address | null,
  siblings: readonly Address[],
  moved: Address,
  beneath: readonly Address[],
): Map<Address, Address> {
  const now = nextChildAddress(parent, siblings);
  const landing = new Map<Address, Address>([[moved, now]]);
  for (const address of beneath) {
    if (!isAncestorAddress(moved, address)) continue;
    landing.set(address, rebaseAddress(moved, now, address));
  }
  return landing;
}

function missing(relation: NoteDestination["relation"]): string {
  return relation === "under"
    ? "The note this springs from is not here."
    : "The note this follows is not here.";
}

/** A landing that is not inside the subtree about to move, which would leave
 *  the note hanging under itself. */
function outside(
  within: ReadonlySet<OwnedRef>,
  parent: StoredNote,
): StoredNote {
  if (within.has(parent.ref)) {
    throw refuse("A note cannot be carried into what sprang from it.");
  }
  return parent;
}

/** How a refusal names the note an address already leads to. Its title, because
 *  the address is the thing being contested. */
function called(note: StoredNote | null): string {
  const title = note?.title.trim();
  return title ? `“${title}”` : "a note you have not titled";
}

function leadsTo(
  address: Address,
  hold: "live" | "deleted" | "moved",
  at: StoredNote | null,
): Error {
  return refuse(
    hold === "deleted"
      ? `${address} leads to ${called(at)}, which you deleted. Pick another number.`
      : `${address} ${hold === "live" ? "already" : "still"} leads to ${called(at)}. Pick another number.`,
  );
}

/** Every address the rule reached is already leading somewhere in this graph,
 *  so there is nothing left for it to offer. */
function allSpent(reached: readonly Address[]): Error {
  return refuse(
    `${reached[0]} through ${reached[reached.length - 1]} all lead somewhere already. Take one of those numbers off a note and try again.`,
  );
}

/** The address a label springs from, refused in words where the number in it is
 *  larger than a graph can carry. */
function impliedParent(address: Address): Address | null {
  try {
    return parentAddress(address);
  } catch {
    throw refuse(
      `${address} is a bigger number than Sloppy can count to. Pick a smaller one.`,
    );
  }
}

function springsElsewhere(address: Address, under: Address | null): Error {
  return refuse(
    under === null
      ? `${address} springs from another note, and this one would spring from nothing. Number it with a whole number, like 7.`
      : `${address} does not spring from ${under}. Number it under ${under} instead.`,
  );
}

/** Two notes of one carried subtree landing on one number. */
function requireDistinct(at: ReadonlyMap<OwnedRef, Address | undefined>): void {
  const taken = new Set<Address>();
  for (const address of at.values()) {
    if (address === undefined) continue;
    if (taken.has(address)) {
      throw refuse(
        `Numbering it that way would put two of these notes at ${address}. Pick another number.`,
      );
    }
    taken.add(address);
  }
}

/** An address a note carried and no longer can, its note purged. */
function leadsNowhere(address: Address): Error {
  return refuse(`You have used ${address} before. Pick another number.`);
}
