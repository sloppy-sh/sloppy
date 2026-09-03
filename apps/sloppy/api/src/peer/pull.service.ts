// Taking a region of somebody else's graph, and reading the copy back.
// docs/ARCHITECTURE.md § "Federating the graph".

import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  type BlockView,
  type CreatePullRequest,
  type DidSyr,
  type NodeView,
  type OwnedRef,
  type Pull,
  type PullView,
  type PublishedSubtreePage,
  UnaskedAnswerError,
  addressDepth,
  compareAddresses,
  publishedSubtreeReader,
  pulledBlockView,
  pulledNodeView,
} from "@sloppy/types";
import { AppConfigService } from "../config/app-config.service";
import { signatureRefutes } from "./attribution";
import { type HeldPage, PullRepository, pullRef } from "./pull.repository";
import { hereOrigin, peerReach, readPeerJson, subtreeUrl } from "./peer-fetch";

/** What somebody is told when an instance answers something other than the
 *  branch that was asked for. What it actually sent is logged, never passed on. */
const UNREADABLE = "Sloppy could not read that branch from that instance.";

@Injectable()
export class PullService {
  private readonly logger = new Logger(PullService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly pulls: PullRepository,
  ) {}

  async list(reader: DidSyr): Promise<PullView[]> {
    return (await this.pulls.listPulls(reader)).map(viewOf);
  }

  /**
   * A region taken page by page, held to what was asked for at every one, and
   * swept only once the last page is in: an answer that stopped partway is not
   * evidence that a note is gone.
   */
  async pull(reader: DidSyr, request: CreatePullRequest): Promise<PullView> {
    const author = request.did;
    const rootAddress = request.root_address;
    const origin = request.source_url ?? hereOrigin(this.config);
    const reading = publishedSubtreeReader({
      did: author,
      root_address: rootAddress,
    });

    let region: Pull | undefined;
    let cursor: string | undefined;
    const declined = new Set<OwnedRef>();
    do {
      const body = await readPeerJson(
        subtreeUrl(origin, author, rootAddress, cursor),
        peerReach(this.config),
      );
      if (body === null) {
        if (cursor === undefined) {
          throw new NotFoundException(
            "Nothing is published at that address on that instance.",
          );
        }
        throw new ServiceUnavailableException(UNREADABLE);
      }
      const page = this.take(reading, body, declined);
      region ??= await this.pulls.openRegion(reader, {
        source_did: author,
        root_address: rootAddress,
        source_url: origin,
      });
      await this.pulls.writePage(reader, author, pullRef(region), held(page));
      cursor = page.next_cursor;
    } while (cursor !== undefined);

    if (region === undefined) throw new ServiceUnavailableException(UNREADABLE);
    const served = reading.served();
    for (const node of declined) served.delete(node);
    await this.sweep(reader, region, served);
    return viewOf(await this.pulls.settleRegion(region, origin));
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
        : addressDepth(region.root_address) + maxDepth - 1;
    const served = await this.pulls.served(reader, ref);
    const rows = await this.pulls.nodesBySource(reader, served);
    return rows
      .filter((row) => bound === undefined || row.depth <= bound)
      .map(pulledNodeView)
      .sort((a, b) => compareAddresses(a.address, b.address));
  }

  async blocks(reader: DidSyr, node: OwnedRef): Promise<BlockView[]> {
    return (await this.pulls.blocksOf(reader, node)).map(pulledBlockView);
  }

  /**
   * One page, held to the question and to the author's own signatures. A note
   * whose own signature refutes it is left out and named in `declined`, so it
   * is neither held nor swept for. `PublishedNodeSchema` bounds the claim, and
   * not presenting ONE note as its author's is not refusing the branch it sits
   * in.
   */
  private take(
    reading: ReturnType<typeof publishedSubtreeReader>,
    body: unknown,
    declined: Set<OwnedRef>,
  ): PublishedSubtreePage {
    let page: PublishedSubtreePage;
    try {
      page = reading.take(body);
    } catch (error) {
      if (error instanceof UnaskedAnswerError) {
        this.logger.warn(error.message);
        throw new ServiceUnavailableException(UNREADABLE);
      }
      throw error;
    }
    const refuted = new Set<OwnedRef>();
    for (const node of page.nodes) {
      if (!signatureRefutes(node)) continue;
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

function held(page: PublishedSubtreePage): HeldPage {
  return {
    nodes: page.nodes.map(({ ref, ...node }) => ({
      source: ref,
      source_did: page.did,
      address: node.address,
      depth: addressDepth(node.address),
      node: { ...node },
    })),
    blocks: page.blocks.map((block) => ({
      source: block.ref,
      node: block.node,
      ord: block.ord,
      content: block.content,
    })),
  };
}

function viewOf(pull: Pull): PullView {
  return {
    ref: pullRef(pull),
    created_by: pull.created_by,
    source_did: pull.source_did,
    root_address: pull.root_address,
    source_url: pull.source_url,
    created_at: pull.created_at,
    updated_at: pull.updated_at,
  };
}
