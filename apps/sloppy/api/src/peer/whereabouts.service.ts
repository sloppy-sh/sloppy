// What somebody says about where their graph is served: reading it, writing
// their own, and serving what this instance keeps on their behalf.
// docs/ARCHITECTURE.md § "Where a person's graph is".

import { Injectable, Logger } from "@nestjs/common";
import {
  type PeerOrigin,
  type Principal,
  type SetWhereaboutsRequest,
  UnaskedAnswerError,
  type Whereabouts,
  parseWhereabouts,
  whereaboutsOf,
} from "@sloppy/types";
import { AppConfigService } from "../config/app-config.service";
import { ownOrigin } from "../media/remote-host";
import { askPeerJson, hereOrigin, peerReach } from "./peer-fetch";
import {
  MAX_WHEREABOUTS_BYTES,
  WHEREABOUTS_TIMEOUT_MS,
  type WhereaboutsAnswer,
  whereaboutsFrom,
  whereaboutsUrl,
} from "./whereabouts";
import { WhereaboutsRepository } from "./whereabouts.repository";

@Injectable()
export class WhereaboutsService {
  private readonly logger = new Logger(WhereaboutsService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly rows: WhereaboutsRepository,
  ) {}

  /** What this instance serves about somebody, out of the words they wrote
   *  here. `null` is somebody who has declared nothing here. */
  async declared(principal: Principal): Promise<Whereabouts | null> {
    const row = await this.rows.find(principal);
    return row === null ? null : whereaboutsOf(row);
  }

  /** Saying it again moves them, and nobody writes anybody else's. */
  async declare(
    viewer: Principal,
    said: SetWhereaboutsRequest,
  ): Promise<Whereabouts> {
    return whereaboutsOf(await this.rows.write(viewer, said));
  }

  async withdraw(viewer: Principal): Promise<void> {
    await this.rows.erase(viewer);
  }

  /**
   * Where somebody says their graph is served.
   *
   * `named` is the instance a reader was given alongside the identifier, and
   * what it serves is a declaration of THEIRS — never a fact baked into the
   * link. So somebody moves instance by saying so there, and a reader holding
   * the old link still finds them. Absent, it is this instance, which is the
   * whole of it for somebody whose graph is kept here.
   */
  whereIs(
    principal: Principal,
    named?: PeerOrigin,
  ): Promise<WhereaboutsAnswer> {
    return whereaboutsFrom({
      principal,
      atDomain: (domain) => this.ask(`https://${domain}`, principal),
      atInstance: () =>
        named === undefined ? this.ours(principal) : this.ask(named, principal),
    });
  }

  /**
   * Which instance a read about somebody is made on: where they SAY their graph
   * is served, and the instance named alongside them where nothing says — which
   * is this one where the reader named none.
   */
  async instanceFor(
    principal: Principal,
    named?: PeerOrigin,
  ): Promise<PeerOrigin> {
    const said = await this.whereIs(principal, named);
    return said.answer === "said"
      ? said.whereabouts.instance
      : (named ?? hereOrigin(this.config));
  }

  /** This instance's own answer, read out of the row rather than asked of
   *  itself over the wire. */
  private async ours(principal: Principal): Promise<WhereaboutsAnswer> {
    const said = await this.declared(principal);
    return said === null
      ? { answer: "none" }
      : { answer: "said", whereabouts: said };
  }

  /**
   * One source, asked. **The origin is built from an address somebody else
   * chose** — a domain out of a declaration, or an instance a reader typed — so
   * the read goes through the outbound guard like every other, and a refusal
   * comes back `unreachable` rather than as a statement about anybody.
   */
  private async ask(
    origin: string,
    principal: Principal,
  ): Promise<WhereaboutsAnswer> {
    if (origin === ownOrigin(this.config.publicUrl))
      return this.ours(principal);
    const url = whereaboutsUrl(origin, principal);
    const said = await askPeerJson(url, peerReach(this.config), {
      maxBytes: MAX_WHEREABOUTS_BYTES,
      timeoutMs: WHEREABOUTS_TIMEOUT_MS,
    });
    if (said.answer === "none") return { answer: "none" };
    if (said.answer === "unreachable") return { answer: "unreachable" };
    try {
      return {
        answer: "said",
        whereabouts: parseWhereabouts(said.body, principal),
      };
    } catch (error) {
      if (!(error instanceof UnaskedAnswerError)) throw error;
      this.logger.warn(`${url}: ${error.message}`);
      return { answer: "none" };
    }
  }
}
