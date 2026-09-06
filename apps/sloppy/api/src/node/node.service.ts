// Nodes, and the one thing about them that is a protocol rather than a feature:
// the address. AI.md § "The Address Is the Protocol".

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  type Address,
  addressDepth,
  type CreateNodeRequestSchema,
  createOwnedRecordId,
  homeGraphRef,
  entityView,
  graphAsked,
  graphOf,
  isInSubtree,
  isRootAddress,
  isUnstyled,
  resolveAppearance,
  seriesIsWhole,
  MAX_TAGS_PER_NODE,
  type Node,
  type NodeAppearance,
  type NodeBulkActSchema,
  type NodeBulkRequestSchema,
  type NodeBulkResult,
  type NodeView,
  nowIso,
  type OwnedRef,
  ownedRefFrom,
  parseNode,
  publishRootsOf,
  type TagCount,
  type Tags,
  TagsSchema,
  type UpdateNodeRequestSchema,
} from "@sloppy/types";
import type { z } from "zod";
import { MediaService } from "../media/media.service";
import { PublicationService } from "../publication/publication.service";
import type { Delegation } from "../syr/syr.service";
import { nextChildAddress } from "./address-assignment";
import { GraphService } from "./graph.service";
import type { AddressHold, NodeBulkPatch } from "./node.repository";
import { NodeRepository } from "./node.repository";
import { SerialQueue } from "./serial-queue";

type CreateRequest = z.output<typeof CreateNodeRequestSchema>;
type UpdateRequest = z.output<typeof UpdateNodeRequestSchema>;
type BulkRequest = z.output<typeof NodeBulkRequestSchema>;
type ChangingAct = Exclude<
  z.output<typeof NodeBulkActSchema>,
  { act: "delete" } | { act: "publish" }
>;

/**
 * A writer in another process gets past the queue and is refused by the unique
 * index. The bound is what stops a pathological loop, not a tuned number.
 */
const ADDRESS_ATTEMPTS = 8;

@Injectable()
export class NodeService {
  private readonly creations = new SerialQueue();

  constructor(
    private readonly nodes: NodeRepository,
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
    return rows.map(entityView);
  }

  async get(did: string, ref: OwnedRef): Promise<NodeView | null> {
    const node = await this.nodes.find(did, ref);
    return node === null ? null : entityView(node);
  }

  tags(did: string, graph?: OwnedRef): Promise<TagCount[]> {
    return this.nodes.tagCounts(did, graph);
  }

  async create(did: string, request: CreateRequest): Promise<NodeView> {
    const { graph, parent } = await this.placeFor(did, request.from);
    const named =
      request.from?.relation === "root" ? request.from.address : null;
    return this.creations.run(`${graph}|${parent?.address ?? ""}`, () =>
      named === null
        ? this.write(did, graph, parent, request)
        : this.writeAt(did, graph, named, request),
    );
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

  /** A node leaves with everything that sprang from it. */
  async remove(did: string, ref: OwnedRef): Promise<void> {
    const node = await this.nodes.find(did, ref);
    if (!node) return;
    await this.nodes.remove(did, await this.nodes.subtree(did, node));
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
      const going = new Map<OwnedRef, Node>();
      for (const kin of await Promise.all(
        mine.map((note) => this.nodes.subtree(did, note)),
      )) {
        for (const node of kin) going.set(ownedRefFrom(node.id), node);
      }
      await this.nodes.remove(did, [...going.values()]);
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
    const out = mine.filter((note) => {
      const ref = ownedRefFrom(note.id);
      return rooted.has(ref)
        ? sent.has(ref)
        : put.some(
            (root) =>
              root.origin === note.origin &&
              isInSubtree(root.address, note.address),
          );
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
    if (!from || from.relation === "root" || from.relation === "branch") {
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

  /** A branch at the number its author picked, which nothing else in that graph
   *  may hold. */
  private async writeAt(
    did: string,
    graph: OwnedRef,
    address: Address,
    request: CreateRequest,
  ): Promise<NodeView> {
    const held = await this.nodes.addressTaken(did, graph, address);
    if (held) throw taken(address, held);
    try {
      return entityView(
        await this.nodes.insert(newNode(did, graph, address, null, request)),
      );
    } catch (err) {
      const lost = await this.nodes.addressTaken(did, graph, address);
      if (lost) throw taken(address, lost);
      throw err;
    }
  }

  private async write(
    did: string,
    graph: OwnedRef,
    parent: Node | null,
    request: CreateRequest,
  ): Promise<NodeView> {
    for (let attempt = 1; ; attempt++) {
      const address = nextChildAddress(
        parent?.address ?? null,
        await this.nodes.childAddresses(did, parent, graph),
      );
      // A branch the server numbers has to be one a person could have named,
      // or the branch after it would have no number left to take.
      if (parent === null && !isRootAddress(address)) {
        throw new BadRequestException(
          "There is no number left after your highest branch. Number a lower one.",
        );
      }
      try {
        return entityView(
          await this.nodes.insert(
            newNode(did, graph, address, parent, request),
          ),
        );
      } catch (err) {
        const lost =
          attempt < ADDRESS_ATTEMPTS &&
          (await this.nodes.addressTaken(did, graph, address)) !== null;
        if (!lost) throw err;
      }
    }
  }
}

function answer(
  asked: number,
  reached: number,
  notes: NodeView[],
): NodeBulkResult {
  return { reached, missed: asked - reached, notes };
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
      `A note carries at most ${MAX_TAGS_PER_NODE} tags, and ${note.address} would go past that. Take a few off it first.`,
    );
  }
  return parsed.data;
}

function taken(address: Address, held: AddressHold): BadRequestException {
  return new BadRequestException(
    held === "live"
      ? `You already have a branch numbered ${address}. Pick another number.`
      : `You used the number ${address} for a branch you have since deleted. Pick another number.`,
  );
}

function newNode(
  did: string,
  graph: OwnedRef,
  address: Address,
  parent: Node | null,
  request: CreateRequest,
): Node {
  const id = createOwnedRecordId("node", did);
  const now = nowIso();
  return parseNode({
    id,
    created_by: did,
    graph,
    address,
    depth: addressDepth(address),
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
