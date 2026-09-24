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

/** How many people are asked about at once. One ask reaches a stranger's
 *  network, and a note may name as many of them as it has voices. */
const ASKED_AT_ONCE = 8;

/** How many keys one identity may be weighed by. Every one of them is tried
 *  against every signature that identity's rows carry. */
const KEYS_WEIGHED = 32;

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
   * rows name them**, and a bounded number of people asked about at once.
   * docs/ARCHITECTURE.md § "Whose a signed row is".
   */
  async contentKeysFor(asked: AskedAt): Promise<Keyholdings> {
    const all = [...asked];
    const answered = new Map<Principal, readonly BoundKey[] | null>();
    for (let at = 0; at < all.length; at += ASKED_AT_ONCE) {
      const run = await Promise.all(
        all
          .slice(at, at + ASKED_AT_ONCE)
          .map(
            async ([principal, where]) =>
              [principal, await this.contentKeysOf(principal, where)] as const,
          ),
      );
      for (const [principal, keys] of run) answered.set(principal, keys);
    }
    return answered;
  }

  private async contentKeysOf(
    principal: Principal,
    at: TrustedInstance | undefined,
  ): Promise<readonly BoundKey[] | null> {
    const held = await this.keysFor(principal);
    if (held === null) return null;
    if (held.length === 0) return held;
    const signing = held.filter((key) => key.signs === "content");
    if (signing.length > 0) return fewEnoughToWeigh(signing);
    // Every key bound to this identifier stands behind the keys that sign
    // rather than signing: which ones it has approved is its instance's to
    // say, and unasked is not the same as none.
    if (at === undefined) return null;
    return fewEnoughToWeigh(
      await approvedKeysFor(this.syr, principal, at, peerReach(this.config)),
    );
  }
}

/** A listing past {@link KEYS_WEIGHED} answers `null` rather than its first
 *  {@link KEYS_WEIGHED}: a key the reader never got to is one an author may
 *  hold, and cutting the list would refute them with their own key unread. */
function fewEnoughToWeigh(
  keys: readonly BoundKey[] | null,
): readonly BoundKey[] | null {
  return keys === null || keys.length > KEYS_WEIGHED ? null : keys;
}
