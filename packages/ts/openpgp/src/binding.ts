// Which key speaks for an email address — the `mailto` arm of `KeyBinding`.
// docs/ARCHITECTURE.md § "Who a person is".

import type { BoundKey, KeyBinding, Principal } from "@sloppy/types";
import { keysSpeakingFor } from "./keys.js";
import { PUBLIC_KEYSERVER, keyserverUrl } from "./keyserver.js";
import { mailboxOf, wkdUrls } from "./wkd.js";

/**
 * What one address said when it was asked for a key.
 *
 * - `held` — a key block came back.
 * - `none` — the address answered, and holds no key for that person. **That
 *   is an answer**, and it is what lets a lookup settle on nobody standing
 *   behind somebody rather than on not knowing.
 * - `unreachable` — nothing answered. A refusal is this too: an instance that
 *   would not make the connection learned nothing either way.
 */
export type KeyAnswer =
  | { readonly answer: "held"; readonly block: Uint8Array }
  | { readonly answer: "none" }
  | { readonly answer: "unreachable" };

/**
 * Reading one address on this binding's behalf.
 *
 * **Every address handed to this is built from a domain somebody else chose**,
 * so the caller is what decides which of them may be connected to. Nothing in
 * this package fetches.
 */
export type ReadKeyAt = (url: string) => Promise<KeyAnswer>;

/**
 * Somebody's own domain first, a public keyserver after it, and the first key
 * found is the answer.
 *
 * `null` where nothing answered anywhere; an empty list where something did
 * and no key for that address is served — the distinction a
 * {@link KeyBinding} is held to, and the one a vouch turns on.
 */
export function mailtoKeyBinding(params: {
  read: ReadKeyAt;
  keyserver?: string;
}): KeyBinding {
  return {
    scheme: "mailto",
    async keysFor(principal: Principal): Promise<readonly BoundKey[] | null> {
      const mailbox = mailboxOf(principal);
      if (mailbox === null) return null;
      const asked = [
        ...wkdUrls(mailbox),
        keyserverUrl(params.keyserver ?? PUBLIC_KEYSERVER, mailbox.address),
      ];
      let answered = false;
      for (const url of asked) {
        const said = await params.read(url);
        if (said.answer === "unreachable") continue;
        answered = true;
        if (said.answer === "none") continue;
        const keys = await keysSpeakingFor(said.block, mailbox.address, url);
        if (keys.length > 0) return keys;
      }
      return answered ? [] : null;
    },
  };
}
