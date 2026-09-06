// A copy of everything one person keeps. `GraphExportSchema` in `@sloppy/types`
// is the document this composes.

import { Injectable } from "@nestjs/common";
import {
  type Address,
  type BlockView,
  blockView,
  type DidSyr,
  entityView,
  type GraphView,
  type NodeView,
  nowIso,
  type OwnedRef,
} from "@sloppy/types";
import { GraphService } from "../node/graph.service";
import { type BlockCursor, ExportRepository } from "./export.repository";

/** A page is let go of once it is written out, so these bound what a copy costs
 *  in memory however much somebody has written. */
const NOTES_PER_READ = 200;
const BLOCKS_PER_READ = 100;

@Injectable()
export class ExportService {
  constructor(
    private readonly graphs: GraphService,
    private readonly rows: ExportRepository,
  ) {}

  /** The whole document, in the pieces it is read in. */
  async *everything(did: DidSyr): AsyncGenerator<string> {
    const graphs = await this.graphs.list(did);
    yield `{"exported_at":${JSON.stringify(nowIso())}`;
    yield `,"did":${JSON.stringify(did)}`;
    yield `,"graphs":${JSON.stringify(graphs)}`;
    yield `,"notes":[`;
    yield* elements(this.notes(did, graphs));
    yield `],"blocks":[`;
    yield* elements(this.blocks(did, graphs));
    yield "]}";
  }

  private async *notes(
    did: DidSyr,
    graphs: readonly GraphView[],
  ): AsyncGenerator<NodeView> {
    for (const graph of graphs) {
      let from: Address | undefined;
      for (;;) {
        const page = await this.rows.notesIn(
          did,
          graph.ref,
          from,
          NOTES_PER_READ,
        );
        for (const note of page) yield entityView(note);
        if (page.length < NOTES_PER_READ) break;
        from = page[page.length - 1].address;
      }
    }
  }

  private async *blocks(
    did: DidSyr,
    graphs: readonly GraphView[],
  ): AsyncGenerator<BlockView> {
    for (const graph of graphs) {
      let from: Address | undefined;
      for (;;) {
        const page = await this.rows.noteRefsIn(
          did,
          graph.ref,
          from,
          NOTES_PER_READ,
        );
        yield* this.stacksOf(
          did,
          page.map((note) => note.ref),
        );
        if (page.length < NOTES_PER_READ) break;
        from = page[page.length - 1].address;
      }
    }
  }

  private async *stacksOf(
    did: DidSyr,
    notes: readonly OwnedRef[],
  ): AsyncGenerator<BlockView> {
    let from: BlockCursor | undefined;
    for (;;) {
      const page = await this.rows.blocksOf(did, notes, from, BLOCKS_PER_READ);
      for (const block of page) yield blockView(block);
      if (page.length < BLOCKS_PER_READ) return;
      const last = page[page.length - 1];
      from = { node: last.node, ord: last.ord };
    }
  }
}

async function* elements(rows: AsyncIterable<unknown>): AsyncGenerator<string> {
  let written = false;
  for await (const row of rows) {
    yield written ? `,${JSON.stringify(row)}` : JSON.stringify(row);
    written = true;
  }
}
