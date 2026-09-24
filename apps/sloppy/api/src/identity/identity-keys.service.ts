// Which key speaks for somebody, whichever scheme they are named in.
// docs/ARCHITECTURE.md § "Who a person is".

import { Injectable } from "@nestjs/common";
import { syrKeyBinding } from "@sloppy/idp";
import { mailtoKeyBinding } from "@sloppy/openpgp";
import {
  type BoundKey,
  type KeyBinding,
  type Principal,
  bindingFor,
} from "@sloppy/types";
import { AppConfigService } from "../config/app-config.service";
import { peerReach } from "../peer/peer-fetch";
import { readKeyThrough } from "./key-fetch";

@Injectable()
export class IdentityKeysService {
  private readonly bindings: readonly KeyBinding[];

  constructor(config: AppConfigService) {
    this.bindings = [
      syrKeyBinding,
      mailtoKeyBinding({ read: readKeyThrough(peerReach(config)) }),
    ];
  }

  /**
   * **`null` is nothing answered**, and a scheme this build holds no binding
   * for. An empty list is an identifier nobody serves a key for, and that is
   * an answer.
   */
  keysFor(principal: Principal): Promise<readonly BoundKey[] | null> {
    const binding = bindingFor(principal, this.bindings);
    return binding === undefined
      ? Promise.resolve(null)
      : binding.keysFor(principal);
  }
}
