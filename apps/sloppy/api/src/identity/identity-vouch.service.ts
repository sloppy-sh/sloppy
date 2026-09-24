// Whether anybody stands behind somebody, whichever scheme they are named in.
// docs/ARCHITECTURE.md § "Who may write where".

import { Injectable } from "@nestjs/common";
import {
  type Principal,
  type PrincipalScheme,
  type TrustedInstance,
  type Vouch,
  type VouchResolver,
  nowIso,
  principalScheme,
} from "@sloppy/types";
import { VouchService } from "../syr/vouch.service";
import { IdentityKeysService } from "./identity-keys.service";

/**
 * One resolver per principal scheme, reached by the scheme the principal is
 * in, so no caller learns which schemes exist — what `bindingFor` already does
 * for keys. A scheme with no resolver here is `unknown`, which grants nothing
 * and takes nothing away.
 */
@Injectable()
export class IdentityVouchService implements VouchResolver {
  private readonly byScheme: Partial<Record<PrincipalScheme, VouchResolver>>;

  constructor(syr: VouchService, keys: IdentityKeysService) {
    this.byScheme = { "did:syr": syr, mailto: keyholderVouch(keys) };
  }

  vouchFor(principal: Principal, at?: TrustedInstance): Promise<Vouch> {
    const scheme = principalScheme(principal);
    const resolver = scheme === undefined ? undefined : this.byScheme[scheme];
    return resolver === undefined
      ? Promise.resolve({ principal, state: "unknown", at: nowIso() })
      : resolver.vouchFor(principal, at);
  }
}

/**
 * Somebody who goes by an email address is stood behind by whoever serves a
 * key for it, and `Vouch.instance` says which of them did.
 *
 * No {@link TrustedInstance} is read: an address a person typed says nothing
 * about where somebody else's key is kept, and the domain in the address is
 * already the only place worth asking first.
 */
function keyholderVouch(keys: IdentityKeysService): VouchResolver {
  return {
    async vouchFor(principal: Principal): Promise<Vouch> {
      const at = nowIso();
      const held = await keys.keysFor(principal);
      if (held === null) return { principal, state: "unknown", at };
      const first = held[0];
      if (first === undefined) return { principal, state: "anonymous", at };
      return {
        principal,
        state: "vouched",
        ...(first.from === undefined ? {} : { instance: first.from }),
        at,
      };
    },
  };
}
