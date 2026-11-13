import { AddressSchema, OwnedRefSchema } from "@sloppy/types";

/** The scheme a citation of a note is written in. */
export const CITATION = "sloppy:";

export type NoteNamed = { note: string } | { address: string };

/** The note `href` names, by ref or by address, or undefined where it names
 *  something outside the graph. */
export function noteNamed(href: string): NoteNamed | undefined {
  const said = href.trim();
  const bare = said.startsWith(CITATION) ? said.slice(CITATION.length) : said;
  const ref = OwnedRefSchema.safeParse(bare);
  if (ref.success) return { note: ref.data };
  if (AddressSchema.safeParse(bare).success) return { address: bare };
  return undefined;
}

/** A link to somewhere on this page rather than away from it. */
export function staysOnPage(href: string): boolean {
  return href.startsWith("#");
}

/** A link to a page on the web. */
export function onTheWeb(href: string): boolean {
  return /^https?:\/\//i.test(href.trim());
}
