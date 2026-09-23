// Whether anybody stands behind an identity, answered by resolving it —
// docs/ARCHITECTURE.md § "Who may write where".

import { Injectable } from "@nestjs/common";
import {
  DidSyrSchema,
  type Principal,
  type TrustedInstance,
  type Vouch,
  type VouchResolver,
  nowIso,
  vouchFrom,
} from "@sloppy/types";
import { AppConfigService } from "../config/app-config.service";
import { peerReach } from "../peer/peer-fetch";
import { SyrService, normalizeInstanceUrl } from "./syr.service";

/**
 * What is read today is syr's listing of root-signed platform delegations — a
 * chain of length one, served with nothing signed on it, which is why
 * {@link TrustedInstance} bounds the addresses a resolution may start from. The
 * mandate chain replaces the reading here, and every caller still reads a
 * {@link Vouch}.
 */
@Injectable()
export class VouchService implements VouchResolver {
  constructor(
    private readonly syr: SyrService,
    private readonly config: AppConfigService,
  ) {}

  async vouchFor(principal: Principal, at?: TrustedInstance): Promise<Vouch> {
    const asked = nowIso();
    const unknown: Vouch = { principal, state: "unknown", at: asked };
    // A syr instance is asked about a syr identity. Anybody else is somebody
    // this resolver has no way of asking about, which is `unknown` and not a
    // statement that nobody stands behind them.
    if (!DidSyrSchema.safeParse(principal).success) return unknown;
    if (at === undefined) return unknown;

    const reach = peerReach(this.config);
    const instance = await this.syr.providerFor(
      normalizeInstanceUrl(at.url),
      principal,
      reach,
    );
    if (instance === null) return unknown;

    const listing = await this.syr.listDelegations(instance, principal, reach);
    return vouchFrom(principal, instance, listing, asked);
  }
}
