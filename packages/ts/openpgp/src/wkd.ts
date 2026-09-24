// Where a domain serves the key for one of its own addresses.
// docs/ARCHITECTURE.md § "Who a person is".

import { sha1 } from "@noble/hashes/legacy.js";
import { MailtoSchema } from "@sloppy/types";
import { zBase32 } from "./zbase32.js";

/** An email address in the two halves an address is built out of, beside the
 *  whole of it. Every part is lowercased, because `MailtoSchema` is what
 *  parsed it. */
export interface Mailbox {
  readonly address: string;
  readonly local: string;
  readonly domain: string;
}

/** `null` is a string that is not an email address this build will ask about. */
export function mailboxOf(principal: string): Mailbox | null {
  const held = MailtoSchema.safeParse(principal);
  if (!held.success) return null;
  const address = held.data.slice("mailto:".length);
  const at = address.lastIndexOf("@");
  return {
    address,
    local: address.slice(0, at),
    domain: address.slice(at + 1),
  };
}

/**
 * The two addresses a domain may serve a key at, the advanced form first.
 *
 * The advanced form sits on a subdomain a domain had to set up deliberately,
 * so a domain that has not is answered by nothing at all there rather than by
 * a refusal — which is why the direct form is asked after it whatever the
 * first one said.
 */
export function wkdUrls(mailbox: Mailbox): readonly string[] {
  const hashed = zBase32(sha1(new TextEncoder().encode(mailbox.local)));
  const asked = `?l=${encodeURIComponent(mailbox.local)}`;
  const at = `/hu/${hashed}${asked}`;
  return [
    `https://openpgpkey.${mailbox.domain}/.well-known/openpgpkey/${mailbox.domain}${at}`,
    `https://${mailbox.domain}/.well-known/openpgpkey${at}`,
  ];
}
