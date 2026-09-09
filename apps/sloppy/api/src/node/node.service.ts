// Nodes, and the one thing about them that is a protocol rather than a feature:
// the address. AI.md § "The Genealogy Is the Protocol".

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  type Address,
  type CreateNodeRequestSchema,
  createOwnedRecordId,
  DELETED_KEPT_FOR_DAYS,
  type DeletedBranch,
  homeGraphRef,
  entityView,
  graphAsked,
  graphOf,
  isAddress,
  isAncestorAddress,
  isRootAddress,
  isUnstyled,
  nextChildAddress,
  resolveAppearance,
  seriesIsWhole,
  MAX_SEARCH_HITS,
  MAX_TAGS_PER_NODE,
  type Node,
  type NodeAlias,
  type NodeAppearance,
  type NodeBulkActSchema,
  type NodeBulkRequestSchema,
  type NodeBulkResult,
  type NodeView,
  type NoteDestination,
  nowIso,
  type OwnedRef,
  ownedRefFrom,
  parentAddress,
  parseNode,
  namesGraph,
  noteLabel,
  orderSiblings,
  publishRootsOf,
  rebaseAddress,
  type SearchHit,
  type TagCount,
  type Tags,
  TagsSchema,
  type UpdateNodeRequestSchema,
} from "@sloppy/types";
import type { z } from "zod";
import { MediaService } from "../media/media.service";
import { PublicationService } from "../publication/publication.service";
import type { Delegation } from "../syr/syr.service";
import { movedSubtree } from "./address-assignment";
import { FindRepository } from "./find.repository";
import { GraphService } from "./graph.service";
import type {
  AddressHold,
  AddressYield,
  NodeBulkPatch,
} from "./node.repository";
import { NodeRepository } from "./node.repository";
import {
  bestFirst,
  notesAmong,
  type Ranked,
  searchWords,
  type SectionMatch,
} from "./search";
import { SerialQueue } from "./serial-queue";

type CreateRequest = z.output<typeof CreateNodeRequestSchema>;
type UpdateRequest = z.output<typeof UpdateNodeRequestSchema>;
type BulkRequest = z.output<typeof NodeBulkRequestSchema>;
type ChangingAct = Exclude<
  z.output<typeof NodeBulkActSchema>,
  { act: "delete" } | { act: "publish" }
>;

/**
 * How many addresses the rule may pass over before it refuses in words. A
 * writer in another process gets past the queue and is refused by the unique
 * index, and a person's own label sits wherever they wrote it. The bound is
 * what stops a pathological loop, not a tuned number.
 */
const ADDRESS_ATTEMPTS = 32;

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class NodeService {
  /** Both writing a note and carrying one read where they are landing and then
   *  write there. They do the reading inside this queue, so neither works from
   *  a place the other has already left. */
  private readonly addressing = new SerialQueue();

  constructor(
    private readonly nodes: NodeRepository,
    private readonly find: FindRepository,
    private readonly graphs: GraphService,
    private readonly media: MediaService,
    private readonly publications: PublicationService,
  ) {}

  /** `graph` is read only when no `origin` is: a tree is in the graph its root
   *  is in, so naming one beside it could only disagree. */
  async list(
    did: string,
    query: { origin?: OwnedRef; maxDepth?: number; graph?: OwnedRef },
  ): Promise<NodeView[]> {
    const rows = query.origin
      ? await this.nodes.region(did, query.origin, query.maxDepth)
      : await this.nodes.roots(did, query.graph);
    return this.asRead(did, rows);
  }

  async get(did: string, ref: OwnedRef): Promise<NodeView | null> {
    const node = await this.nodes.find(did, ref);
    return node === null ? null : (await this.asRead(did, [node]))[0];
  }

  /** Notes of one graph as they answer, each carrying the addresses it was
   *  moved from — absent aliases is a note that has never been moved, so a read
   *  that left them off would say that of every note it found. */
  private async asRead(
    did: string,
    rows: readonly Node[],
  ): Promise<NodeView[]> {
    if (rows.length === 0) return [];
    const aliases = await this.nodes.aliasesOf(
      did,
      graphOf(rows[0]),
      rows.map((one) => ownedRefFrom(one.id)),
    );
    return rows.map((one) => {
      const was = aliases.get(ownedRefFrom(one.id));
      return { ...entityView(one), ...(was ? { aliases: was } : {}) };
    });
  }

  tags(did: string, graph?: OwnedRef): Promise<TagCount[]> {
    return this.nodes.tagCounts(did, graph);
  }

  /**
   * The notes `asked` reaches, best match first: the one it addresses ahead of
   * the ones whose writing carries it, their own and the copies they hold,
   * inside one graph where they name one and across every graph they keep where
   * they name none. At most {@link MAX_SEARCH_HITS}.
   */
  async search(
    did: string,
    asked: string,
    graph?: OwnedRef,
  ): Promise<SearchHit[]> {
    const cited = await this.addressed(did, asked, graph);
    const words = searchWords(asked);
    if (words === "") return cited;
    const [ownNotes, heldNotes] = await this.notesWithin(did, graph);
    const [own, held] = await Promise.all([
      this.find.writingMatches(did, words, ownNotes),
      this.find.heldWritingMatches(did, words, heldNotes),
    ]);
    const found = [
      ...(await this.ownHits(did, own)),
      ...(await this.heldHits(did, held)),
    ];
    const already = new Set(cited.map((hit) => hit.note));
    return [
      ...cited,
      ...found
        .sort(bestFirst)
        .map((one) => one.hit)
        .filter((hit) => !already.has(hit.note)),
    ].slice(0, MAX_SEARCH_HITS);
  }

  /** The notes `asked` reaches as an address, or none where it is not one. A
   *  citation written down before a move still leads to the note it named, so
   *  an address carried away from answers alongside the one a note is at. */
  private async addressed(
    did: string,
    asked: string,
    graph?: OwnedRef,
  ): Promise<SearchHit[]> {
    const address = asked.trim().toLowerCase();
    if (!isAddress(address)) return [];
    const reach = await this.find.notesAddressed(did, address, graph);
    const at = new Set(reach.at);
    const notes = await this.nodes.many(did, [
      ...new Set([...reach.at, ...reach.carriedAway]),
    ]);
    return orderSiblings(
      notes.map((note) => ({
        ref: ownedRefFrom(note.id),
        address: note.address,
        created_at: note.created_at,
        node: note,
      })),
    ).map(({ node: note }) => ({
      note: ownedRefFrom(note.id),
      ...(note.address === undefined ? {} : { address: note.address }),
      graph: graphOf(note),
      title: note.title,
      snippet: "",
      created_at: note.created_at,
      ...(at.has(ownedRefFrom(note.id)) ? {} : { wasAt: address }),
      held: false,
    }));
  }

  async recent(
    did: string,
    query: { graph?: OwnedRef; limit: number },
  ): Promise<NodeView[]> {
    const within =
      query.graph === undefined
        ? undefined
        : await this.nodes.notesIn(did, query.graph);
    return this.notesAt(
      did,
      await this.find.lastWritten(did, query.limit, within),
    );
  }

  /** Which of their own notes and which of the copies they hold a search may
   *  answer with, or neither bound where no graph is named. */
  private notesWithin(
    did: string,
    graph?: OwnedRef,
  ): Promise<[OwnedRef[] | undefined, OwnedRef[] | undefined]> {
    if (graph === undefined) return Promise.resolve([undefined, undefined]);
    return Promise.all([
      this.nodes.notesIn(did, graph),
      this.find.heldNotesIn(did, graph),
    ]);
  }

  private async ownHits(
    did: string,
    sections: readonly SectionMatch[],
  ): Promise<Ranked[]> {
    const found = notesAmong(sections);
    if (found.size === 0) return [];
    const notes = await this.nodes.many(did, [...found.keys()]);
    return notes.flatMap((note) => {
      const ref = ownedRefFrom(note.id);
      const carried = found.get(ref);
      if (!carried) return [];
      return [
        {
          matches: carried.matches,
          hit: {
            note: ref,
            address: note.address,
            graph: graphOf(note),
            title: note.title,
            snippet: carried.snippet,
            created_at: note.created_at,
            held: false,
          },
        },
      ];
    });
  }

  private async heldHits(
    did: string,
    sections: readonly SectionMatch[],
  ): Promise<Ranked[]> {
    const found = notesAmong(sections);
    if (found.size === 0) return [];
    const notes = await this.find.heldNotes(did, [...found.keys()]);
    return notes.flatMap((note) => {
      const carried = found.get(note.source);
      if (!carried) return [];
      return [
        {
          matches: carried.matches,
          hit: {
            note: note.source,
            address: note.address,
            graph: note.graph,
            title: note.title,
            snippet: carried.snippet,
            ...(note.created_at === undefined
              ? {}
              : { created_at: note.created_at }),
            held: true,
          },
        },
      ];
    });
  }

  /** The notes at these references, in the order they were named. */
  private async notesAt(
    did: string,
    written: readonly OwnedRef[],
  ): Promise<NodeView[]> {
    if (written.length === 0) return [];
    const at = new Map(written.map((ref, place) => [ref, place] as const));
    const notes = await this.nodes.many(did, written);
    return notes
      .sort(
        (a, b) =>
          (at.get(ownedRefFrom(a.id)) ?? 0) - (at.get(ownedRefFrom(b.id)) ?? 0),
      )
      .map(entityView);
  }

  async create(did: string, request: CreateRequest): Promise<NodeView> {
    const from = request.from;
    if (from?.relation === "root" && request.address !== undefined) {
      throw new BadRequestException(
        "Sloppy is out of date. Update it and try again.",
      );
    }
    return this.addressing.run(did, async () => {
      if (request.address !== undefined) {
        return this.writeNumbered(did, request, request.address);
      }
      if (from?.relation === "root") {
        return this.writeAt(
          did,
          await this.graphFor(did, from),
          from.address,
          request,
        );
      }
      if (from?.relation === "free") {
        return entityView(
          await this.nodes.insert(
            newNode(did, await this.graphFor(did, from), null, request),
          ),
        );
      }
      return this.write(did, request);
    });
  }

  /** The graph a new branch opens in, where the placement is one that names a
   *  graph at all. */
  private async graphFor(
    did: string,
    from: CreateRequest["from"],
  ): Promise<OwnedRef> {
    const asked = graphAsked(from);
    if (asked === undefined) return homeGraphRef(did);
    await this.graphs.requireHeld(did, asked);
    return asked;
  }

  async update(
    did: string,
    ref: OwnedRef,
    request: UpdateRequest,
    delegation: Delegation | undefined,
  ): Promise<NodeView> {
    const updated = await this.nodes.patch(
      did,
      ref,
      request.appearance === undefined
        ? request
        : {
            ...request,
            appearance: await this.look(request.appearance, delegation),
          },
    );
    if (!updated) throw new NotFoundException("That note is not here.");
    return entityView(updated);
  }

  /**
   * The label a person cites this note by, written or taken off. The address it
   * leaves keeps leading to it, and an address it has carried before is its own
   * to take back — AI.md § "The Genealogy Is the Protocol".
   */
  async setAddress(
    did: string,
    ref: OwnedRef,
    address: Address | null,
  ): Promise<NodeView> {
    return this.addressing.run(did, async () => {
      const note = await this.nodes.find(did, ref);
      if (!note) throw new NotFoundException("That note is not here.");
      const own = new Set([ownedRefFrom(note.id)]);
      const free = async () =>
        address === null
          ? null
          : this.claim(did, graphOf(note), address, own, ownedRefFrom(note.id));
      const giving = await free();
      const written = await this.nodes
        .writeAddress(
          did,
          note,
          address ?? undefined,
          note.address === undefined || note.address === address
            ? null
            : leftBehind(note, note.address),
          giving ? [giving] : [],
        )
        .catch(async (err: unknown) => {
          await free();
          throw err;
        });
      if (!written) throw new NotFoundException("That note is not here.");
      return (await this.asRead(did, [written]))[0];
    });
  }

  /** The address made this note's to take, or refused in words where it leads
   *  somewhere else in this graph. A writer in another process gets past the
   *  queue and is refused by the unique index, so this is asked again on the way
   *  out of a failed write. `mine` is the notes landing together, whose hold on
   *  it one write replaces; `taking` is the one landing on this address, and an
   *  address a note was carried away from is that note's alone to take back —
   *  AI.md § "The Genealogy Is the Protocol". */
  private async claim(
    did: string,
    graph: OwnedRef,
    address: Address,
    mine: ReadonlySet<OwnedRef>,
    taking: OwnedRef,
  ): Promise<AddressYield | null> {
    const held = await this.nodes.addressLeadsTo(did, graph, address);
    if (held === null) return null;
    if (
      held.note !== undefined &&
      (held.hold === "moved" ? held.note === taking : mine.has(held.note))
    ) {
      return null;
    }
    return this.yieldedBy(did, graph, address, held);
  }

  /** The same question asked for a note that does not exist yet, which no
   *  address in the graph can be leading to. */
  private async claimUnheld(
    did: string,
    graph: OwnedRef,
    address: Address,
  ): Promise<AddressYield | null> {
    const held = await this.nodes.addressLeadsTo(did, graph, address);
    return held === null ? null : this.yieldedBy(did, graph, address, held);
  }

  /** Throws where the note this address leads to is there rather than in the
   *  bin: only a note in the bin gives its address up. */
  private async yieldedBy(
    did: string,
    graph: OwnedRef,
    address: Address,
    held: { hold: AddressHold; note?: OwnedRef },
  ): Promise<AddressYield | null> {
    if (held.note === undefined) throw leadsNowhere(address);
    const there = await this.nodes.find(did, held.note);
    if (there) throw leadsTo(address, held.hold, there);
    const binned = await this.nodes.findDeleted(did, held.note);
    if (!binned) throw leadsTo(address, held.hold, null);
    // Already given up once: its alias stands and its row is at another number.
    if (binned.address !== address) return null;
    const back = await this.nodes.aliasedTo(did, graph, address);
    return back === null
      ? { from: binned, alias: leftBehind(binned, address) }
      : { from: binned };
  }

  /**
   * A note carried somewhere else, with everything that sprang from it. The
   * answer is that subtree as it now stands, because a move can re-address all
   * of it — AI.md § "The Genealogy Is the Protocol".
   *
   * `address` is the label the person named for it; absent, the rule offers one.
   */
  async move(
    did: string,
    ref: OwnedRef,
    to: NoteDestination,
    address?: Address,
  ): Promise<NodeView[]> {
    return this.addressing.run(did, async () => {
      const note = await this.nodes.find(did, ref);
      if (!note) throw new NotFoundException("That note is not here.");
      const carried = await this.nodes.carried(did, note);
      const landing = await this.landingFor(did, note, to, carried);
      const graph = graphOf(note);
      return address === undefined
        ? this.carry(did, note, graph, carried, landing)
        : this.carryTo(did, note, graph, carried, landing, address);
    });
  }

  /**
   * The note a move hangs the carried one under, `null` where it becomes a
   * branch of its own. Every refusal a move has is a destination it cannot
   * take, so they are all here.
   */
  private async landingFor(
    did: string,
    note: Node,
    to: NoteDestination,
    carried: readonly Node[],
  ): Promise<Node | null> {
    if (to.note === ownedRefFrom(note.id)) {
      throw new BadRequestException("Carry this note to a different one.");
    }
    const anchor = await this.nodes.find(did, to.note);
    if (!anchor) throw new BadRequestException(missing(to.relation));
    if (graphOf(anchor) !== graphOf(note)) {
      throw new BadRequestException(
        "That note is in another graph. A note stays in the graph it was written in.",
      );
    }
    const within = new Set(carried.map((one) => ownedRefFrom(one.id)));
    if (to.relation === "under") return outside(within, anchor);
    if (!anchor.parent) return null;
    const parent = await this.nodes.find(did, anchor.parent);
    if (!parent) throw new BadRequestException(missing(to.relation));
    return outside(within, parent);
  }

  /**
   * The subtree where it now sits, with the address each note leaves behind
   * still leading to it. Deleted notes under it are carried too; only the ones
   * that are there come back in the answer.
   *
   * Which notes are re-addressed is the whole of what the address rule decides
   * here — docs/ARCHITECTURE.md § "The genealogy and the address" — and the
   * depths, the origin and the parent are rewritten either way.
   */
  private async carry(
    did: string,
    note: Node,
    graph: OwnedRef,
    carried: readonly Node[],
    parent: Node | null,
  ): Promise<NodeView[]> {
    const ref = ownedRefFrom(note.id);
    const beneath = carried.filter((one) => ownedRefFrom(one.id) !== ref);
    const was = note.address;
    const run =
      was === undefined || (parent !== null && parent.address === undefined)
        ? null
        : await this.nodes.childAddresses(did, parent, graph);
    // Where the subtree would land on a label its author wrote outside this
    // run, the whole of it moves along to the next address instead.
    const passed: Address[] = [];
    for (let attempt = 1; ; attempt++) {
      const landing =
        run === null || was === undefined
          ? null
          : movedSubtree(
              parent?.address ?? null,
              [...run, ...passed],
              was,
              beneath.flatMap((one) => (one.address ? [one.address] : [])),
            );
      const now =
        landing === null || was === undefined
          ? undefined
          : (landing.get(was) as Address);
      if (parent === null && now !== undefined && !isRootAddress(now)) {
        throw new BadRequestException(
          "There is no number left after your highest branch. Carry this note under a note instead.",
        );
      }

      const spent = async () =>
        landing !== null &&
        (await this.nodes.addressesSpent(did, graph, [...landing.values()]))
          .size > 0;
      if (now !== undefined && (await spent())) {
        if (attempt >= ADDRESS_ATTEMPTS) throw allSpent([...passed, now]);
        passed.push(now);
        continue;
      }

      const { root, landed, aliases } = landedRows(
        note,
        parent,
        carried,
        landing,
        now,
      );
      try {
        await this.nodes.move(did, landed, aliases);
        return this.asRead(did, await this.nodes.subtree(did, root));
      } catch (err) {
        if (now === undefined || !(await spent())) throw err;
        if (attempt >= ADDRESS_ATTEMPTS) throw allSpent([...passed, now]);
        passed.push(now);
      }
    }
  }

  /**
   * The same carry, landing on the address the person named rather than the one
   * the rule offers. Every refusal is here rather than in the rule, because a
   * label somebody wrote is never quietly moved to the next number for them.
   */
  private async carryTo(
    did: string,
    note: Node,
    graph: OwnedRef,
    carried: readonly Node[],
    parent: Node | null,
    now: Address,
  ): Promise<NodeView[]> {
    const under = parent === null ? null : parent.address;
    if (under === undefined) {
      throw new BadRequestException(
        `${called(parent)} has no number, so a note springing from it can carry none either. Number that note first, or carry this one without a number.`,
      );
    }
    if (impliedParent(now) !== under) throw springsElsewhere(now, under);

    const ref = ownedRefFrom(note.id);
    const was = note.address;
    const landing = new Map<Address, Address>();
    const taking = new Map<Address, OwnedRef>([[now, ref]]);
    if (was !== undefined) {
      landing.set(was, now);
      for (const one of carried) {
        const at = one.address;
        if (at !== undefined && isAncestorAddress(was, at)) {
          const to = rebaseAddress(was, now, at);
          landing.set(at, to);
          taking.set(to, ownedRefFrom(one.id));
        }
      }
    }

    const mine = new Set(carried.map((one) => ownedRefFrom(one.id)));
    mine.add(ref);
    const giving: AddressYield[] = [];
    for (const [at, who] of taking) {
      const gives = await this.claim(did, graph, at, mine, who);
      if (gives) giving.push(gives);
    }

    const { root, landed, aliases } = landedRows(
      note,
      parent,
      carried,
      landing,
      now,
    );
    requireDistinct(landed);
    await this.nodes
      .move(did, landed, aliases, giving)
      .catch(async (err: unknown) => {
        await this.claim(did, graph, now, mine, ref);
        throw err;
      });
    return this.asRead(did, await this.nodes.subtree(did, root));
  }

  /**
   * A node goes with everything that sprang from it, and can be put back until
   * {@link DELETED_KEPT_FOR_DAYS} have passed. Whatever the branch was
   * publishing comes down first and does not come back with it.
   */
  async remove(
    did: string,
    ref: OwnedRef,
    delegation: Delegation | undefined,
  ): Promise<void> {
    await this.sweep(did);
    const node = await this.nodes.find(did, ref);
    if (!node) return;
    const going = await this.nodes.subtree(did, node);
    await this.takeDownWithin(did, going, delegation);
    await this.nodes.remove(did, going);
  }

  /**
   * A graph closed, and every note in it sent the way {@link remove} sends a
   * branch: what they published comes down first, and their addresses retire
   * with them rather than coming free. The name goes last, so a refusal partway
   * leaves the graph standing.
   */
  async closeGraph(
    did: string,
    ref: OwnedRef,
    delegation: Delegation | undefined,
  ): Promise<void> {
    await this.graphs.requireClosable(did, ref);
    await this.sweep(did);
    const roots = await this.nodes.roots(did, ref);
    const going = (
      await Promise.all(roots.map((root) => this.nodes.subtree(did, root)))
    ).flat();
    await this.takeDownWithin(did, going, delegation);
    await this.nodes.remove(did, going);
    await this.graphs.close(did, ref);
  }

  /** The branches this person deleted and can still put back, newest first. */
  async deleted(did: string): Promise<DeletedBranch[]> {
    await this.sweep(did);
    const branches = branchesAmong(await this.nodes.deletedNotes(did));
    const standing = await this.graphsStanding(
      did,
      branches.map((branch) => branch.graph),
    );
    return branches.filter((branch) => standing.has(branch.graph));
  }

  private async graphsStanding(
    did: string,
    named: readonly OwnedRef[],
  ): Promise<Set<OwnedRef>> {
    const standing = new Set<OwnedRef>();
    for (const ref of new Set(named)) {
      if (await this.graphs.holds(did, ref)) standing.add(ref);
    }
    return standing;
  }

  /** One of them back where it was, with its writing and whatever address it
   *  still holds. One that gave its number to another note comes back with
   *  none, and the alias that still leads to it says which it was. */
  async restore(did: string, ref: OwnedRef): Promise<NodeView> {
    await this.sweep(did);
    const gone = await this.nodes.findDeleted(did, ref);
    if (!gone || !(await this.graphs.holds(did, graphOf(gone)))) {
      throw new NotFoundException("That branch is not here to put back.");
    }
    if (gone.parent && (await this.nodes.findDeleted(did, gone.parent))) {
      throw new BadRequestException(
        "Put the branch above this one back first.",
      );
    }
    await this.nodes.restore(did, gone);
    const back = await this.nodes.find(did, ref);
    if (!back)
      throw new NotFoundException("That branch is not here to put back.");
    return (await this.asRead(did, [back]))[0];
  }

  /**
   * Everything anybody deleted longer ago than they can put it back, and how
   * many people that was for. The routes above sweep whoever walked them;
   * somebody who deletes a branch and never comes back is only reached here.
   */
  async sweepEveryone(): Promise<number> {
    const before = windowClosed();
    const authors = await this.nodes.authorsPast(before);
    for (const did of authors) await this.nodes.purgeExpired(did, before);
    return authors.length;
  }

  /** Everything they deleted longer ago than they can put it back. */
  private async sweep(did: string): Promise<void> {
    await this.nodes.purgeExpired(did, windowClosed());
  }

  /**
   * Every publication rooted inside a branch that is going, taken down before
   * it does: a publication owns copies of its pictures, and only the take-down
   * releases them.
   */
  private async takeDownWithin(
    did: string,
    going: readonly Node[],
    delegation: Delegation | undefined,
  ): Promise<void> {
    const chains = await this.publications.rootedIn(
      did,
      new Set(going.map((node) => ownedRefFrom(node.id))),
    );
    if (chains.length === 0) return;
    if (!delegation) throw new UnauthorizedException("Sign in to continue.");
    for (const chain of chains) {
      await this.publications.remove(delegation, chain);
    }
  }

  /**
   * One act over the notes somebody chose. Only their own are reached, and a
   * note that has gone since their graph was drawn is counted rather than
   * treated as a failure — one stale mark in a selection of forty is something
   * to mention, not a reason to refuse the other thirty-nine.
   */
  async bulk(
    did: string,
    request: BulkRequest,
    delegation: Delegation | undefined,
  ): Promise<NodeBulkResult> {
    const asked = [...new Set(request.notes)];
    const mine = await this.nodes.many(did, asked);
    if (mine.length === 0) {
      throw new NotFoundException(
        "None of those notes are here any more. Reload your graph and try again.",
      );
    }

    if (request.act.act === "delete") {
      await this.sweep(did);
      const going = new Map<OwnedRef, Node>();
      for (const kin of await Promise.all(
        mine.map((note) => this.nodes.subtree(did, note)),
      )) {
        for (const node of kin) going.set(ownedRefFrom(node.id), node);
      }
      const all = [...going.values()];
      await this.takeDownWithin(did, all, delegation);
      await this.nodes.remove(did, all);
      return answer(asked.length, mine.length, []);
    }

    if (request.act.act === "publish") {
      if (!delegation) throw new UnauthorizedException("Sign in to continue.");
      return this.publishEach(delegation, asked.length, mine);
    }

    const written = await this.nodes.patchAll(
      did,
      await this.writes(mine, request.act, delegation),
    );
    return answer(asked.length, written.length, written.map(entityView));
  }

  /**
   * Each chosen note published as it stands, and how much of the set that
   * reached. A chosen note whose own chain was asked for and refused did not go
   * out however much of the rest did, and one with no chain of its own goes out
   * only if the chosen note carrying it went out.
   */
  private async publishEach(
    delegation: Delegation,
    asked: number,
    mine: readonly Node[],
  ): Promise<NodeBulkResult> {
    const rooted = await this.publications.rootedAmong(
      delegation.did,
      mine.map((note) => ownedRefFrom(note.id)),
    );
    const put: Node[] = [];
    let refusal: unknown;
    for (const root of publishRootsOf(mine, (note) =>
      rooted.has(ownedRefFrom(note.id)),
    )) {
      try {
        await this.publications.publish(delegation, {
          root: ownedRefFrom(root.id),
        });
        put.push(root);
      } catch (err) {
        refusal ??= err;
      }
    }
    // Nothing went out, so the person reads why rather than a count of it.
    if (put.length === 0) throw refusal;

    const sent = new Set(put.map((root) => ownedRefFrom(root.id)));
    // What a root carried out is its subtree, which a person's own labels
    // cannot be read as.
    const within = new Set<OwnedRef>();
    for (const root of put) {
      for (const node of await this.nodes.subtree(delegation.did, root)) {
        within.add(ownedRefFrom(node.id));
      }
    }
    const out = mine.filter((note) => {
      const ref = ownedRefFrom(note.id);
      return rooted.has(ref) ? sent.has(ref) : within.has(ref);
    });
    const after = await this.nodes.many(
      delegation.did,
      out.map((note) => ownedRefFrom(note.id)),
    );
    return answer(asked, after.length, after.map(entityView));
  }

  /** What each note the act reached is about to be set to. */
  private async writes(
    notes: readonly Node[],
    act: ChangingAct,
    delegation: Delegation | undefined,
  ): Promise<Map<OwnedRef, NodeBulkPatch>> {
    const each = (of: (note: Node) => NodeBulkPatch) =>
      new Map(notes.map((note) => [ownedRefFrom(note.id), of(note)] as const));

    switch (act.act) {
      case "tag":
      case "untag":
        return each((note) => ({
          tags: retag(note, act.act === "tag", act.tags),
        }));
      case "set_appearance": {
        const appearance = await this.look(act.appearance, delegation);
        return each(() => ({ appearance }));
      }
    }
  }

  /**
   * The look about to be written. A picture is checked against the person's own
   * store first — owning one is not enough to use it for anything,
   * docs/ARCHITECTURE.md § "Pictures" — and the address that check answers with
   * is deliberately not kept, because a note's picture is read back through the
   * session of whoever owns it.
   */
  private async look(
    appearance: NodeAppearance | null,
    delegation: Delegation | undefined,
  ): Promise<NodeAppearance | null> {
    if (isUnstyled(appearance)) return null;
    // Pictures behind an absent first one never draw and would read as a
    // styled note, so the shape is refused rather than stored.
    if (!seriesIsWhole(appearance)) {
      throw new BadRequestException("Choose a picture for this note first.");
    }
    // EVERY picture in the series, not just the first: the rest reach the same
    // request and the guard is what says a person may only show their own.
    const series = resolveAppearance(appearance).preview.pictures;
    if (series.length > 0) {
      if (!delegation) throw new UnauthorizedException("Sign in to continue.");
      for (const picture of series) {
        await this.media.ownPicture(delegation, picture, "block");
      }
    }
    return appearance;
  }

  /**
   * Where a new node goes: the graph it is filed in and the node it hangs
   * under. A note placed `after` another takes that note's parent, which is
   * what makes `1a` → `1b` and `1` → `2` the same act at two depths. It takes
   * that note's GRAPH either way — a branch has no parent to read one off.
   */
  private async placeFor(
    did: string,
    from: CreateRequest["from"],
  ): Promise<{ graph: OwnedRef; parent: Node | null }> {
    if (!from || namesGraph(from)) {
      return { graph: await this.graphFor(did, from), parent: null };
    }
    const anchor = await this.nodes.find(did, from.note);
    if (!anchor) {
      throw new BadRequestException(
        from.relation === "under"
          ? "The note this springs from is not here."
          : "The note this follows is not here.",
      );
    }
    const graph = graphOf(anchor);
    if (from.relation === "under") return { graph, parent: anchor };
    if (!anchor.parent) return { graph, parent: null };
    const parent = await this.nodes.find(did, anchor.parent);
    if (!parent) {
      throw new BadRequestException("The note this follows is not here.");
    }
    return { graph, parent };
  }

  /** A branch at the number its author picked, which nothing in that graph but a
   *  note in the bin may be holding. */
  private async writeAt(
    did: string,
    graph: OwnedRef,
    address: Address,
    request: CreateRequest,
  ): Promise<NodeView> {
    const giving = await this.claimUnheld(did, graph, address);
    try {
      return entityView(
        await this.nodes.insert(
          newNode(did, graph, null, request, address),
          giving ? [giving] : [],
        ),
      );
    } catch (err) {
      await this.claimUnheld(did, graph, address);
      throw err;
    }
  }

  /**
   * A note written at the address its author named rather than at the one the
   * rule offers. Held to everything {@link setAddress} holds a label to, and to
   * the one thing a standing note is not held to: it springs from the address
   * of the note it is written under, or from nothing where it opens a branch.
   */
  private async writeNumbered(
    did: string,
    request: CreateRequest,
    address: Address,
  ): Promise<NodeView> {
    const { graph, parent } = await this.placeFor(did, request.from);
    const under = parent === null ? null : parent.address;
    if (under === undefined) {
      throw new BadRequestException(
        `${called(parent)} has no number, so a note springing from it can carry none either. Number that note first, or write this one without a number.`,
      );
    }
    if (impliedParent(address) !== under)
      throw springsElsewhere(address, under);
    const giving = await this.claimUnheld(did, graph, address);
    try {
      return entityView(
        await this.nodes.insert(
          newNode(did, graph, parent, request, address),
          giving ? [giving] : [],
        ),
      );
    } catch (err) {
      await this.claimUnheld(did, graph, address);
      throw err;
    }
  }

  private async write(did: string, request: CreateRequest): Promise<NodeView> {
    // The run read by parent cannot show a label its author wrote on a note
    // somewhere else in the graph, so the addresses that turn out to be spent
    // are fed back into it and the rule offers the next one.
    const passed: Address[] = [];
    for (let attempt = 1; ; attempt++) {
      const { graph, parent } = await this.placeFor(did, request.from);
      if (parent !== null && parent.address === undefined) {
        return entityView(
          await this.nodes.insert(newNode(did, graph, parent, request)),
        );
      }
      const address = nextChildAddress(parent?.address ?? null, [
        ...(await this.nodes.childAddresses(did, parent, graph)),
        ...passed,
      ]);
      // A branch the server numbers has to be one a person could have named,
      // or the branch after it would have no number left to take.
      if (parent === null && !isRootAddress(address)) {
        throw new BadRequestException(
          "There is no number left after your highest branch. Number a lower one.",
        );
      }
      if ((await this.nodes.addressTaken(did, graph, address)) !== null) {
        if (attempt >= ADDRESS_ATTEMPTS) throw allSpent([...passed, address]);
        passed.push(address);
        continue;
      }
      try {
        return entityView(
          await this.nodes.insert(
            newNode(did, graph, parent, request, address),
          ),
        );
      } catch (err) {
        if ((await this.nodes.addressTaken(did, graph, address)) === null) {
          throw err;
        }
        if (attempt >= ADDRESS_ATTEMPTS) throw allSpent([...passed, address]);
        passed.push(address);
      }
    }
  }
}

function missing(relation: NoteDestination["relation"]): string {
  return relation === "under"
    ? "The note this springs from is not here."
    : "The note this follows is not here.";
}

/** A landing that is not inside the subtree about to move, which would leave
 *  the note hanging under itself. `within` is the notes the move carries: a
 *  person writes their own addresses, so what sprang from a note is not in
 *  them. */
function outside(within: ReadonlySet<OwnedRef>, parent: Node): Node {
  if (within.has(ownedRefFrom(parent.id))) {
    throw new BadRequestException(
      "A note cannot be carried into what sprang from it.",
    );
  }
  return parent;
}

/** How a refusal names the note an address already leads to. Its title, because
 *  the address is the thing being contested. */
function called(note: Node | null): string {
  const title = note?.title.trim();
  return title ? `“${title}”` : "a note you have not titled";
}

function leadsTo(
  address: Address,
  hold: AddressHold,
  at: Node | null,
): BadRequestException {
  return new BadRequestException(
    hold === "deleted"
      ? `${address} leads to ${called(at)}, which you deleted. Pick another number.`
      : `${address} ${hold === "live" ? "already" : "still"} leads to ${called(at)}. Pick another number.`,
  );
}

/** Every address the rule reached is already leading somewhere in this graph,
 *  so there is nothing left for it to offer. */
function allSpent(reached: readonly Address[]): BadRequestException {
  return new BadRequestException(
    `${reached[0]} through ${reached[reached.length - 1]} all lead somewhere already. Take one of those numbers off a note and try again.`,
  );
}

/** The address a label springs from, refused in words where the number in it is
 *  larger than a graph can carry. */
function impliedParent(address: Address): Address | null {
  try {
    return parentAddress(address);
  } catch {
    throw new BadRequestException(
      `${address} is a bigger number than Sloppy can count to. Pick a smaller one.`,
    );
  }
}

/** A named address that disagrees with where the note is landing. */
function springsElsewhere(
  address: Address,
  under: Address | null,
): BadRequestException {
  return new BadRequestException(
    under === null
      ? `${address} springs from another note, and this one would spring from nothing. Number it with a whole number, like 7.`
      : `${address} does not spring from ${under}. Number it under ${under} instead.`,
  );
}

/** Two notes of one carried subtree landing on one number, which the graph's own
 *  rule that an address leads one way would otherwise be left to refuse. */
function requireDistinct(landed: readonly Node[]): void {
  const taken = new Set<Address>();
  for (const one of landed) {
    if (one.address === undefined) continue;
    if (taken.has(one.address)) {
      throw new BadRequestException(
        `Numbering it that way would put two of these notes at ${one.address}. Pick another number.`,
      );
    }
    taken.add(one.address);
  }
}

/** An address a note carried and no longer can, its note purged. */
function leadsNowhere(address: Address): BadRequestException {
  return new BadRequestException(
    `You have used ${address} before. Pick another number.`,
  );
}

/** A carried subtree as it lands: the rows to write, the root among them, and
 *  the addresses they leave behind still leading to them. */
function landedRows(
  note: Node,
  parent: Node | null,
  carried: readonly Node[],
  landing: Map<Address, Address> | null,
  now: Address | undefined,
): { root: Node; landed: Node[]; aliases: NodeAlias[] } {
  const ref = ownedRefFrom(note.id);
  const beneath = carried.filter((one) => ownedRefFrom(one.id) !== ref);
  const addressAt = new Map<OwnedRef, Address | undefined>([[ref, now]]);
  for (const one of beneath) {
    addressAt.set(
      ownedRefFrom(one.id),
      one.address === undefined
        ? undefined
        : (landing?.get(one.address) ?? one.address),
    );
  }
  const origin = parent ? parent.origin : ref;
  const depthAt = depthsUnder(carried, ref, parent ? parent.depth + 1 : 1);
  const landedAt = (one: Node, over: Partial<Node> = {}) => {
    const { address: _left, ...rest } = one;
    const at = addressAt.get(ownedRefFrom(one.id));
    return parseNode({
      ...rest,
      ...(at === undefined ? {} : { address: at }),
      depth: depthAt(one),
      origin,
      ...over,
    });
  };
  const root = landedAt(note, {
    parent: parent ? ownedRefFrom(parent.id) : undefined,
  });
  return {
    root,
    landed: [root, ...beneath.map((one) => landedAt(one))],
    aliases: carried.flatMap((one) =>
      one.address !== undefined &&
      one.address !== addressAt.get(ownedRefFrom(one.id))
        ? [leftBehind(one, one.address)]
        : [],
    ),
  };
}

/** The address a note is leaving, still leading to it. A note with none leaves
 *  nothing behind. */
function leftBehind(was: Node, address: Address): NodeAlias {
  const at = nowIso();
  return {
    id: createOwnedRecordId("node_alias", was.created_by),
    created_by: was.created_by,
    graph: graphOf(was),
    ...(was.parent ? { parent: was.parent } : {}),
    address,
    note: ownedRefFrom(was.id),
    created_at: at,
    updated_at: at,
  };
}

/**
 * The depth every note of a carried subtree lands at, read off the parent chain
 * and not off the address: a note its author left unaddressed is carried like
 * any other.
 */
function depthsUnder(
  carried: readonly Node[],
  root: OwnedRef,
  rootDepth: number,
): (one: Node) => number {
  const byRef = new Map(carried.map((one) => [ownedRefFrom(one.id), one]));
  const known = new Map<OwnedRef, number>([[root, rootDepth]]);
  const depthOf = (one: Node): number => {
    const at = ownedRefFrom(one.id);
    const held = known.get(at);
    if (held !== undefined) return held;
    const up = one.parent === undefined ? undefined : byRef.get(one.parent);
    const depth = up === undefined ? rootDepth : depthOf(up) + 1;
    known.set(at, depth);
    return depth;
  };
  return depthOf;
}

/** The moment before which a deleted branch can no longer be put back. */
function windowClosed(): string {
  return new Date(Date.now() - DELETED_KEPT_FOR_DAYS * DAY_MS).toISOString();
}

function answer(
  asked: number,
  reached: number,
  notes: NodeView[],
): NodeBulkResult {
  return { reached, missed: asked - reached, notes };
}

/**
 * Of the notes somebody deleted, the ones a listing offers back: those whose
 * parent is still there, so putting one back never leaves a note hanging under
 * nothing. A note deleted before the branch above it waits its turn and is
 * offered again once that branch is back. Newest first.
 *
 * What comes back with one is what went with it in the same act, which is why
 * a note deleted earlier is counted under nothing but itself.
 */
function branchesAmong(gone: readonly Node[]): DeletedBranch[] {
  const byRef = new Map(gone.map((node) => [ownedRefFrom(node.id), node]));
  const away = new Set(byRef.keys());
  const springsFrom = (root: OwnedRef, node: Node): boolean => {
    const seen = new Set<OwnedRef>();
    for (let walk: Node | undefined = node; walk !== undefined; ) {
      const at = ownedRefFrom(walk.id);
      if (at === root) return true;
      if (seen.has(at)) return false;
      seen.add(at);
      walk = walk.parent === undefined ? undefined : byRef.get(walk.parent);
    }
    return false;
  };
  const under = (root: Node, at: string) =>
    gone.filter(
      (node) =>
        node.deleted_at === at && springsFrom(ownedRefFrom(root.id), node),
    ).length;
  const branches = gone.flatMap((root) => {
    const at = root.deleted_at;
    if (at === undefined) return [];
    if (root.parent && away.has(root.parent)) return [];
    return [
      {
        ref: ownedRefFrom(root.id),
        ...(root.address === undefined ? {} : { address: root.address }),
        graph: graphOf(root),
        title: root.title,
        deleted_at: at,
        created_at: root.created_at,
        notes: under(root, at),
      },
    ];
  });
  // Newest act first, and the run's own order inside one act — the sort is
  // stable, so `orderSiblings` decides what a person reads down the list.
  return orderSiblings(branches)
    .sort((a, b) => b.deleted_at.localeCompare(a.deleted_at))
    .map(({ created_at: _written, ...branch }) => branch);
}

/**
 * A note's tags after an act. `TagsSchema` decides the answer, so what is
 * checked and what is stored are one computation. The address is in the refusal
 * because a person choosing forty notes cannot otherwise tell which one it is.
 */
function retag(note: Node, adding: boolean, named: Tags): Tags {
  const after = adding
    ? [...note.tags, ...named]
    : note.tags.filter((tag) => !named.includes(tag));
  const parsed = TagsSchema.safeParse(after);
  if (!parsed.success) {
    throw new BadRequestException(
      `A note carries at most ${MAX_TAGS_PER_NODE} tags, and ${noteLabel(note)} would go past that. Take a few off it first.`,
    );
  }
  return parsed.data;
}

function newNode(
  did: string,
  graph: OwnedRef,
  parent: Node | null,
  request: CreateRequest,
  address?: Address,
): Node {
  const id = createOwnedRecordId("node", did);
  const now = nowIso();
  return parseNode({
    id,
    created_by: did,
    graph,
    ...(address === undefined ? {} : { address }),
    depth: parent ? parent.depth + 1 : 1,
    ...(parent ? { parent: ownedRefFrom(parent.id) } : {}),
    origin: parent ? parent.origin : ownedRefFrom(id),
    title: request.title,
    tags: request.tags,
    links: [],
    published: false,
    created_at: now,
    updated_at: now,
  });
}
