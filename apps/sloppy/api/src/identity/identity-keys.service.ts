// Which key speaks for somebody, whichever scheme they are named in.
// docs/ARCHITECTURE.md § "Who a person is".

import { Injectable } from "@nestjs/common";
import { syrKeyBinding } from "@sloppy/idp";
import { mailtoKeyBinding } from "@sloppy/openpgp";
import {
  type BoundKey,
  type KeyBinding,
  type Principal,
  type TrustedInstance,
  bindingFor,
} from "@sloppy/types";
import { AppConfigService } from "../config/app-config.service";
import { peerReach } from "../peer/peer-fetch";
import { SyrService } from "../syr/syr.service";
import { approvedKeysFor } from "./delegated-keys";
import { readKeyThrough } from "./key-fetch";

/** Who to ask about, and where their own instance may be asked what it has
 *  approved. Absent for somebody nobody named an address for. */
export type AskedAt = ReadonlyMap<Principal, TrustedInstance | undefined>;

/** What each of them is known to sign with. `null` keeps the meaning
 *  {@link KeyBinding} gives it: nobody answered, which is never an identity
 *  holding no key. */
export type Keyholdings = ReadonlyMap<Principal, readonly BoundKey[] | null>;

/** The one ask a reader makes about a page, made only where the page holds a
 *  signature to weigh. */
export type AskWhoHolds = () => Promise<Keyholdings>;

@Injectable()
export class IdentityKeysService {
  private readonly bindings: readonly KeyBinding[];

  constructor(
    private readonly config: AppConfigService,
    private readonly syr: SyrService,
  ) {
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

  /**
   * What these people sign content with — **one ask per person, however many
   * rows name them.** A page of fifty notes by three people is three asks, and
   * asking per row would aim this instance at a stranger's network fifty times
   * to learn the same three things.
   */
  async contentKeysFor(asked: AskedAt): Promise<Keyholdings> {
    const answered = await Promise.all(
      [...asked].map(
        async ([principal, at]) =>
          [principal, await this.contentKeysOf(principal, at)] as const,
      ),
    );
    return new Map(answered);
  }

  private async contentKeysOf(
    principal: Principal,
    at: TrustedInstance | undefined,
  ): Promise<readonly BoundKey[] | null> {
    const held = await this.keysFor(principal);
    if (held === null) return null;
    if (held.length === 0) return held;
    const signing = held.filter((key) => key.signs === "content");
    if (signing.length > 0) return signing;
    // Every key bound to this identifier stands behind the keys that sign
    // rather than signing: which ones it has approved is its instance's to
    // say, and unasked is not the same as none.
    return at === undefined
      ? null
      : approvedKeysFor(this.syr, principal, at, peerReach(this.config));
  }
}
