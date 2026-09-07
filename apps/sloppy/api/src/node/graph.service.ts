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
    if (isHomeGraphRef(ref)) {
      throw new BadRequestException("The graph you started with stays.");
    }
    await this.requireHeld(did, ref);
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
