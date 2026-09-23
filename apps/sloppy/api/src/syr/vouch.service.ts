// Whether anybody stands behind an identity, answered by resolving it —
// docs/ARCHITECTURE.md § "Who may write where".

import { Injectable } from "@nestjs/common";
import {
  type DidSyr,
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

  async vouchFor(did: DidSyr, at?: TrustedInstance): Promise<Vouch> {
    const asked = nowIso();
    if (at === undefined) return { did, state: "unknown", at: asked };

    const reach = peerReach(this.config);
    const instance = await this.syr.providerFor(
      normalizeInstanceUrl(at.url),
      did,
      reach,
    );
    if (instance === null) return { did, state: "unknown", at: asked };

    const listing = await this.syr.listDelegations(instance, did, reach);
    return vouchFrom(did, instance, listing, asked);
  }
}
