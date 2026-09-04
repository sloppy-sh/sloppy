// Graphs: the notebooks a person keeps, and the context each address is read
// in. AI.md § "The Address Is the Protocol".

import { BadRequestException, Injectable } from "@nestjs/common";
import {
  type DidSyr,
  entityView,
  type GraphView,
  HOME_GRAPH_TITLE,
  homeGraphRef,
  isHomeGraphRef,
  type OwnedRef,
  splitOwnedRef,
} from "@sloppy/types";
import { GraphRepository } from "./graph.repository";

@Injectable()
export class GraphService {
  constructor(private readonly graphs: GraphRepository) {}

  /**
   * Every graph somebody keeps, the home one first. Everybody has that one
   * before they have a row for it, so this is the read that writes it.
   */
  async list(did: DidSyr): Promise<GraphView[]> {
    const home = homeGraphRef(did);
    await this.graphs.ensure(did, home, HOME_GRAPH_TITLE);
    const rows = await this.graphs.list(did);
    return rows
      .map(entityView)
      .sort((a, b) => Number(b.ref === home) - Number(a.ref === home));
  }

  async open(did: DidSyr, title: string): Promise<GraphView> {
    return entityView(await this.graphs.insert(did, title));
  }

  async rename(did: DidSyr, ref: OwnedRef, title: string): Promise<GraphView> {
    await this.requireHeld(did, ref);
    return entityView(await this.graphs.name(did, ref, title));
  }

  /** Whether somebody may file a note in this graph. The home graph is theirs
   *  before it has a row, so it is answered without a read. */
  async holds(did: DidSyr, ref: OwnedRef): Promise<boolean> {
    if (splitOwnedRef(ref).did !== did) return false;
    if (isHomeGraphRef(ref)) return true;
    return (await this.graphs.find(did, ref)) !== null;
  }

  async requireHeld(did: DidSyr, ref: OwnedRef): Promise<void> {
    if (!(await this.holds(did, ref))) {
      throw new BadRequestException("That graph is not here.");
    }
  }
}
