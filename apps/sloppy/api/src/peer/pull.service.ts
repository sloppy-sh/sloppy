// Taking a region of somebody else's graph, and reading the copy back.
// docs/ARCHITECTURE.md § "Federating the graph".

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  type Address,
  type BlockView,
  type CreatePullRequest,
  type DidSyr,
  type NodeView,
  type OwnedRef,
  type Principal,
  type Pull,
  type PullView,
  type PublishedSubtreePage,
  type PulledNoteHit,
  UnaskedAnswerError,
  addressDepth,
  orderSiblings,
  entityView,
  graphRef,
  publishedSubtreeReader,
  pulledBlockView,
  pulledNodeView,
  splitOwnedRef,
} from "@sloppy/types";
import { AppConfigService } from "../config/app-config.service";
import { signatureRefutes } from "./attribution";
import {
  type HeldPage,
  PullRepository,
  type RegionTerms,
  pullRef,
} from "./pull.repository";
import { peerReach, readPeerJson, subtreeUrl } from "./peer-fetch";
import { WhereaboutsService } from "./whereabouts.service";

/** What somebody is told when an instance answers something other than the
 *  branch that was asked for. What it actually sent is logged, never passed on. */
const UNREADABLE = "Sloppy could not read that branch from that instance.";

@Injectable()
export class PullService {
  private readonly logger = new Logger(PullService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly pulls: PullRepository,
    private readonly whereabouts: WhereaboutsService,
  ) {}

  async list(reader: DidSyr): Promise<PullView[]> {
    return (await this.pulls.listPulls(reader)).map(entityView);
  }

  /**
   * A version taken page by page, held to what was asked for at every one, and
   * swept only once the last page is in: an answer that stopped partway is not
   * evidence that a note is gone.
   *
   * What the copy is OF comes off the answer rather than off the request: an
   * absent version asks for the newest, and the snapshot the reader ends up
   * holding is the one the first page named.
   */
  async pull(reader: DidSyr, request: CreatePullRequest): Promise<PullView> {
    const publication = request.publication;
    const author = splitOwnedRef(publication).owner;
    if (author === reader) {
      throw new BadRequestException("That branch is already in your graph.");
    }
    const origin = await this.whereabouts.instanceFor(
      author,
      request.source_url,
    );
    const reading = publishedSubtreeReader({
      publication,
      version: request.version,
    });

    let region: Pull | undefined;
    let terms: RegionTerms | undefined;
    let cursor: string | undefined;
    const declined = new Set<OwnedRef>();
    // How deep in the AUTHOR's graph each held note sits, walked down the
    // parents a page carries rather than read out of an address a person
    // writes.
    const deep = new Map<OwnedRef, number>();
    do {
      const body = await readPeerJson(
        subtreeUrl(origin, publication, request.version, cursor),
        peerReach(this.config),
      );
      if (body === null) {
        if (cursor === undefined) {
          throw new NotFoundException("That branch is not published there.");
        }
        throw new ServiceUnavailableException(UNREADABLE);
      }
      const page = await this.take(reading, body, declined, deep);
      terms ??= {
        publication,
        version: page.version,
        ...(page.root_address === undefined
          ? {}
          : { root_address: page.root_address }),
        graph: graphRef(author, page.graph),
        ...(page.graph_title === undefined
          ? {}
          : { graph_title: page.graph_title }),
        comments: page.comments,
        source_url: origin,
      };
      region ??= await this.pulls.openRegion(reader, terms);
      await this.pulls.writePage(
        reader,
        author,
        pullRef(region),
        held(page, author, graphRef(author, page.graph), deep),
      );
      cursor = page.next_cursor;
    } while (cursor !== undefined);

    if (region === undefined || terms === undefined) {
      throw new ServiceUnavailableException(UNREADABLE);
    }
    const served = reading.served();
    for (const node of declined) served.delete(node);
    await this.sweep(reader, region, served);
    return entityView(await this.pulls.settleRegion(region, terms));
  }

  async drop(reader: DidSyr, ref: OwnedRef): Promise<void> {
    const region = await this.pulls.findPull(reader, ref);
    if (region === null) return;
    const at = pullRef(region);
    await this.pulls.release(reader, at, await this.pulls.served(reader, at));
    await this.pulls.closeRegion(reader, region);
  }

  /**
   * A held region's notes, in address order. `maxDepth` counts from the
   * REGION's own root, not from the author's — a region pulled at `1a1` starts
   * at its root however deep that sits in the graph it came from.
   */
  async nodes(
    reader: DidSyr,
    ref: OwnedRef,
    maxDepth?: number,
  ): Promise<NodeView[]> {
    const region = await this.pulls.findPull(reader, ref);
    if (region === null)
      throw new NotFoundException("That region is not here.");
    const bound =
      maxDepth === undefined
        ? undefined
        : rootDepth(region.root_address) + maxDepth - 1;
    const served = await this.pulls.served(reader, ref);
    const rows = await this.pulls.nodesBySource(reader, served);
    return orderSiblings(
      rows
        .filter((row) => bound === undefined || row.depth <= bound)
        .map(pulledNodeView),
    );
  }

  async blocks(reader: DidSyr, node: OwnedRef): Promise<BlockView[]> {
    return (await this.pulls.blocksOf(reader, node)).map(pulledBlockView);
  }

  /**
   * One note the reader holds a copy of, found by the reference its AUTHOR
   * addresses it under — which is the reference a citation carries. `null`
   * where they hold none of it, which is what a citation to a branch nobody
   * here has pulled answers.
   */
  async heldBySource(
    reader: DidSyr,
    node: OwnedRef,
  ): Promise<PulledNoteHit | null> {
    const [held] = await this.pulls.nodesBySource(reader, [node]);
    if (held === undefined) return null;
    const [region] = await this.pulls.regionsServing(reader, node);
    if (region === undefined) return null;
    return { note: pulledNodeView(held), pull: entityView(region) };
  }

  /**
   * One page, held to the question and to the author's own signatures. A note
   * whose own signature refutes it is left out and named in `declined`, so it
   * is neither held nor swept for. `PublishedNodeSchema` bounds the claim, and
   * not presenting ONE note as its author's is not refusing the branch it sits
   * in — which is why the depths are walked before a note is dropped, so the
   * notes under a dropped one still know where they sit.
   */
  private async take(
    reading: ReturnType<typeof publishedSubtreeReader>,
    body: unknown,
    declined: Set<OwnedRef>,
    deep: Map<OwnedRef, number>,
  ): Promise<PublishedSubtreePage> {
    let page: PublishedSubtreePage;
    try {
      page = reading.take(body);
      deepen(page, deep);
    } catch (error) {
      if (error instanceof UnaskedAnswerError) {
        this.logger.warn(error.message);
        throw new ServiceUnavailableException(UNREADABLE);
      }
      throw error;
    }
    const refuted = new Set<OwnedRef>();
    for (const node of page.nodes) {
      if (!(await signatureRefutes(node))) continue;
      this.logger.warn(`${node.ref} does not carry its author's signature`);
      refuted.add(node.ref);
      declined.add(node.ref);
    }
    if (refuted.size === 0) return page;
    return {
      ...page,
      nodes: page.nodes.filter((node) => !refuted.has(node.ref)),
      blocks: page.blocks.filter((block) => !refuted.has(block.node)),
    };
  }

  /** What the region served last time and no longer does. Sections are swept
   *  as the notes carrying them are written, page by page. */
  private async sweep(
    reader: DidSyr,
    region: Pull,
    served: ReadonlySet<OwnedRef>,
  ): Promise<void> {
    const at = pullRef(region);
    const held = await this.pulls.served(reader, at);
    await this.pulls.release(
      reader,
      at,
      held.filter((source) => !served.has(source)),
    );
  }
}

/**
 * How deep in the AUTHOR's graph a region's own root sits. Its address says
 * where, and a region whose author gave it none reads as a branch of theirs:
 * nothing on the wire places it any deeper, and how deep a reader may read into
 * the copy counts from here either way.
 */
function rootDepth(address: Address | undefined): number {
  return address === undefined ? 1 : addressDepth(address);
}

/**
 * How deep each note a page carries sits, written into `deep` — the region's
 * root where {@link rootDepth} puts it, and everything else one below the note
 * it springs from, wherever in the answer that note arrived.
 */
function deepen(page: PublishedSubtreePage, deep: Map<OwnedRef, number>): void {
  const opening = rootDepth(page.root_address);
  let waiting = page.nodes;
  while (waiting.length > 0) {
    const later: typeof waiting = [];
    for (const node of waiting) {
      if (node.parent === undefined) {
        deep.set(node.ref, opening);
        continue;
      }
      const above = deep.get(node.parent);
      if (above === undefined) later.push(node);
      else deep.set(node.ref, above + 1);
    }
    if (later.length === waiting.length) {
      throw new UnaskedAnswerError(
        `${later[0].ref}, which springs from nothing this region sent`,
      );
    }
    waiting = later;
  }
}

function held(
  page: PublishedSubtreePage,
  author: Principal,
  graph: OwnedRef,
  deep: Map<OwnedRef, number>,
): HeldPage {
  return {
    nodes: page.nodes.map(({ ref, ...node }) => {
      const depth = deep.get(ref) as number;
      return {
        source: ref,
        source_did: author,
        source_graph: graph,
        ...(node.address === undefined ? {} : { address: node.address }),
        ...(node.aliases ? { aliases: node.aliases } : {}),
        depth,
        node: { ...node },
      };
    }),
    blocks: page.blocks.map((block) => ({
      source: block.ref,
      node: block.node,
      ord: block.ord,
      content: block.content,
    })),
  };
}
