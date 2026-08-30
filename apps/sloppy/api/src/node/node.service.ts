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
  entityView,
  isRootAddress,
  isUnstyled,
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
  type TagCount,
  type Tags,
  TagsSchema,
  type UpdateNodeRequestSchema,
} from "@sloppy/types";
import type { z } from "zod";
import { MediaService } from "../media/media.service";
import type { Delegation } from "../syr/syr.service";
import { nextChildAddress } from "./address-assignment";
import type { NodeBulkPatch } from "./node.repository";
import { NodeRepository } from "./node.repository";
import { SerialQueue } from "./serial-queue";

type CreateRequest = z.output<typeof CreateNodeRequestSchema>;
type UpdateRequest = z.output<typeof UpdateNodeRequestSchema>;
type BulkRequest = z.output<typeof NodeBulkRequestSchema>;
type ChangingAct = Exclude<
  z.output<typeof NodeBulkActSchema>,
  { act: "delete" }
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
    private readonly media: MediaService,
  ) {}

  async list(
    did: string,
    query: { origin?: OwnedRef; maxDepth?: number },
  ): Promise<NodeView[]> {
    const rows = query.origin
      ? await this.nodes.region(did, query.origin, query.maxDepth)
      : await this.nodes.roots(did);
    return rows.map(entityView);
  }

  async get(did: string, ref: OwnedRef): Promise<NodeView | null> {
    const node = await this.nodes.find(did, ref);
    return node === null ? null : entityView(node);
  }

  tags(did: string): Promise<TagCount[]> {
    return this.nodes.tagCounts(did);
  }

  async create(did: string, request: CreateRequest): Promise<NodeView> {
    const parent = await this.parentFor(did, request.from);
    const named =
      request.from?.relation === "root" ? request.from.address : null;
    return this.creations.run(`${did}|${parent?.address ?? ""}`, () =>
      named === null
        ? this.write(did, parent, request)
        : this.writeAt(did, named, request),
    );
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

    const written = await this.nodes.patchAll(
      did,
      await this.writes(mine, request.act, delegation),
    );
    return answer(asked.length, written.length, written.map(entityView));
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
      case "publish":
      case "unpublish":
        return each(() => ({ published: act.act === "publish" }));
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
    const preview = appearance?.preview;
    if (preview !== undefined) {
      if (!delegation) throw new UnauthorizedException("Sign in to continue.");
      await this.media.ownPicture(delegation, preview, "block");
    }
    return appearance;
  }

  /**
   * The node the new one hangs under. A note placed `after` another takes the
   * same parent as that one, which is what makes `1a` → `1b` and `1` → `2` the
   * same act at two depths.
   */
  private async parentFor(
    did: string,
    from: CreateRequest["from"],
  ): Promise<Node | null> {
    if (!from || from.relation === "root") return null;
    const anchor = await this.nodes.find(did, from.note);
    if (!anchor) {
      throw new BadRequestException(
        from.relation === "under"
          ? "The note this springs from is not here."
          : "The note this follows is not here.",
      );
    }
    if (from.relation === "under") return anchor;
    if (!anchor.parent) return null;
    const parent = await this.nodes.find(did, anchor.parent);
    if (!parent) {
      throw new BadRequestException("The note this follows is not here.");
    }
    return parent;
  }

  /** A branch at the number its author picked, which nothing else may hold. */
  private async writeAt(
    did: string,
    address: Address,
    request: CreateRequest,
  ): Promise<NodeView> {
    if (await this.nodes.addressTaken(did, address)) throw taken(address);
    try {
      return entityView(
        await this.nodes.insert(newNode(did, address, null, request)),
      );
    } catch (err) {
      if (await this.nodes.addressTaken(did, address)) throw taken(address);
      throw err;
    }
  }

  private async write(
    did: string,
    parent: Node | null,
    request: CreateRequest,
  ): Promise<NodeView> {
    for (let attempt = 1; ; attempt++) {
      const address = nextChildAddress(
        parent?.address ?? null,
        await this.nodes.childAddresses(did, parent),
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
          await this.nodes.insert(newNode(did, address, parent, request)),
        );
      } catch (err) {
        const lost =
          attempt < ADDRESS_ATTEMPTS &&
          (await this.nodes.addressTaken(did, address));
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

function taken(address: Address): BadRequestException {
  return new BadRequestException(
    `You already have a branch numbered ${address}. Pick another number.`,
  );
}

function newNode(
  did: string,
  address: Address,
  parent: Node | null,
  request: CreateRequest,
): Node {
  const id = createOwnedRecordId("node", did);
  const now = nowIso();
  return parseNode({
    id,
    created_by: did,
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
