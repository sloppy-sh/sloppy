// Where a public keyserver answers for an address a domain serves no key for.
// docs/ARCHITECTURE.md § "Who a person is".

/**
 * The keyserver asked when a domain answers with no key of its own.
 *
 * This one serves an address only to somebody who proved they hold it, which
 * is what makes a key found here worth as much as a key the domain served. A
 * keyserver that hands out whatever it was given stands behind nobody, so
 * pointing this elsewhere is a decision about what `vouched` means here.
 */
export const PUBLIC_KEYSERVER = "https://keys.openpgp.org";

/** Where `origin` answers a lookup by address, in the shape
 *  {@link PUBLIC_KEYSERVER} speaks. */
export function keyserverUrl(origin: string, address: string): string {
  const at = origin.replace(/\/+$/, "");
  return `${at}/vks/v1/by-email/${encodeURIComponent(address)}`;
}
