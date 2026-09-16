// Graphs: the notebooks a person keeps, and the context each address is read
// in. AI.md § "The Genealogy Is the Protocol".

import { BadRequestException, Injectable } from "@nestjs/common";
import {
  type DidSyr,
  entityView,
  type GraphView,
  HOME_GRAPH_TITLE,
  type OwnedRef,
  ownedRefFrom,
  splitOwnedRef,
  type UpdateGraphRequestSchema,
} from "@sloppy/types";
import type { z } from "zod";
import { GraphRepository } from "./graph.repository";
import { SerialQueue } from "./serial-queue";

type UpdateRequest = z.output<typeof UpdateGraphRequestSchema>;

@Injectable()
export class GraphService {
  /** One mint at a time per person: two reads landing together would each find
   *  no home graph and open one. */
  private readonly minting = new SerialQueue();

  constructor(private readonly graphs: GraphRepository) {}

  /**
   * Every graph somebody keeps, the one they started with first. That one is
   * written the first time anybody asks for it, which is what gives a rename
   * something to rename.
   */
  async list(did: DidSyr): Promise<GraphView[]> {
    const home = await this.home(did);
    const rows = await this.graphs.list(did);
    return rows
      .map(entityView)
      .sort((a, b) => Number(b.ref === home) - Number(a.ref === home));
  }

  /**
   * The graph a note that names none goes in. Its ulid is its own, so this is a
   * read rather than a spelling — docs/ARCHITECTURE.md § "The genealogy and the
   * address".
   */
  async home(did: DidSyr): Promise<OwnedRef> {
    return this.minting.run(did, async () => {
      const found = await this.graphs.home(did);
      if (found !== null) return found;
      try {
        const opened = await this.graphs.insert(did, HOME_GRAPH_TITLE, true);
        return ownedRefFrom(opened.id);
      } catch (err) {
        // One home graph per person is `graph_owner_home`'s rule, so a second
        // process minting alongside this one is refused rather than raced.
        const won = await this.graphs.home(did);
        if (won === null) throw err;
        return won;
      }
    });
  }

  async open(did: DidSyr, title: string): Promise<GraphView> {
    return entityView(await this.graphs.insert(did, title));
  }

  /** Rename one, and say what it gates the notes written in it by. */
  async write(
    did: DidSyr,
    ref: OwnedRef,
    changes: UpdateRequest,
  ): Promise<GraphView> {
    await this.requireHeld(did, ref);
    return entityView(
      await this.graphs.name(did, ref, changes.title, changes.ownership),
    );
  }

  /**
   * Who gates a note written in this graph: its writer where the graph gates
   * the notes written in it, and nobody where it does not —
   * docs/ARCHITECTURE.md § "Whose writing a note carries".
   */
  async gate(did: DidSyr, graph: OwnedRef): Promise<DidSyr | undefined> {
    const row = await this.row(did, graph);
    return row?.ownership === "owned" ? did : undefined;
  }

  /**
   * A graph they opened, closed. Only its name goes here; the notes it held go
   * through the node service, which is what calls this.
   *
   * The ref is never issued again — `ulid()` writes the moment it is drawn into
   * the first ten characters — so the addresses assigned in this graph cannot
   * come back under a new name.
   */
  async close(did: DidSyr, ref: OwnedRef): Promise<void> {
    await this.requireClosable(did, ref);
    await this.graphs.remove(did, ref);
  }

  /** The graph somebody started with is where a note that names none goes, so
   *  it is not one they can close. */
  async requireClosable(did: DidSyr, ref: OwnedRef): Promise<void> {
    const row = await this.row(did, ref);
    if (row === null) throw notHere();
    if (row.home) {
      throw new BadRequestException("The graph you started with stays.");
    }
  }

  /** Whether somebody may file a note in this graph. */
  async holds(did: DidSyr, ref: OwnedRef): Promise<boolean> {
    return (await this.row(did, ref)) !== null;
  }

  async requireHeld(did: DidSyr, ref: OwnedRef): Promise<void> {
    if (!(await this.holds(did, ref))) throw notHere();
  }

  private async row(did: DidSyr, ref: OwnedRef) {
    if (splitOwnedRef(ref).did !== did) return null;
    return this.graphs.find(did, ref);
  }
}

function notHere(): BadRequestException {
  return new BadRequestException("That graph is not here.");
}
