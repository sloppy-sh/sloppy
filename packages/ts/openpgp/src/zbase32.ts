// z-base-32, the encoding a Web Key Directory address spells a hash in.
// docs/ARCHITECTURE.md § "Who a person is".

/** Not RFC 4648's: the same five bits per character, a different alphabet, and
 *  no padding. */
const ALPHABET = "ybndrfg8ejkmcpqxot1uwisza345h769";

/** Five bits to a character, most significant first, the last one filled out
 *  with zeroes. */
export function zBase32(bytes: Uint8Array): string {
  let written = "";
  let held = 0;
  let bits = 0;
  for (const byte of bytes) {
    held = ((held << 8) | byte) & 0xfff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      written += ALPHABET[(held >>> bits) & 0x1f];
    }
  }
  return bits === 0 ? written : written + ALPHABET[(held << (5 - bits)) & 0x1f];
}
