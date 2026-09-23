// Whether anybody stands behind an identity, answered by resolving it —
// docs/ARCHITECTURE.md § "Who may write where".

import { Injectable } from "@nestjs/common";
import {
  type DidSyr,
  type InstanceHint,
  type Vouch,
  type VouchResolver,
  nowIso,
  vouchFrom,
} from "@sloppy/types";
import { SyrService, normalizeInstanceUrl } from "./syr.service";

/**
 * The hint says where to start looking and decides nothing: the identity's own
 * record is resolved from it, and the authority held for that identity is read
 * where the record says it is answered. A hint that points somewhere hostile can
 * fail to resolve and can do nothing else.
 *
 * What is read today is a listing of root-signed delegations, which is a chain
 * of length one. A mandate chain — root, then agent, then whoever holds the
 * grant — replaces that reading here, and every caller still reads a
 * {@link Vouch}.
 */
@Injectable()
export class VouchService implements VouchResolver {
  constructor(private readonly syr: SyrService) {}

  async vouchFor(did: DidSyr, hint?: InstanceHint): Promise<Vouch> {
    const at = nowIso();
    if (hint === undefined) return { did, state: "unknown", at };

    const instance = await this.syr.providerFor(
      normalizeInstanceUrl(hint),
      did,
    );
    if (instance === null) return { did, state: "unknown", at };

    const listing = await this.syr.listDelegations(instance, did);
    return vouchFrom(did, instance, listing, at);
  }
}
