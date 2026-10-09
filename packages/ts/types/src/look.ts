// The app's own look: the axes a person sets, and a look as a file they can
// send somebody — DESIGN.md § "The look" and § "A look is a file".

import { z } from "zod";

/** How surfaces are DRAWN — edges and elevation, never colour. `default` is
 *  the one the app carries no attribute for. */
export const STYLES = [
  "default",
  "hardline",
  "bevel",
  "terminal",
  "pixel",
] as const;
export type Style = (typeof STYLES)[number];

/** How close everything is drawn. `auto` is whatever the device is. */
export const DENSITIES = ["auto", "comfortable", "compact"] as const;
export type Density = (typeof DENSITIES)[number];

/** What the screen itself is drawn like over everything else. */
export const EFFECTS = ["none", "crt"] as const;
export type Effect = (typeof EFFECTS)[number];

/** A look's id: one of Sloppy's own, or a scheme's slug in the collection.
 *  `data-look` carries exactly this. */
export const LOOK_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const LOOK_NAME_MAX = 80;

/** A family name as a person types it, with room for the longest they are
 *  likely to own. */
export const FACE_NAME_MAX = 80;

/** What a look's own rules run to. Past this it is a stylesheet rather than a
 *  look, and it rides along in every copy anybody passes on. */
export const LOOK_CSS_MAX = 64 * 1024;

const NO_WEB = "A look cannot load anything from the web.";
const NO_IMPORT = `${NO_WEB} Take out the @import.`;
const NO_PICTURE = `${NO_WEB} Take out the picture it loads from the web.`;

const COMMENT = /\/\*[\s\S]*?\*\//g;
const IMPORTS = /@\s*import/i;
const URL_CALL = /url\(([^)]*)\)?/gi;
const NUMERIC_ESCAPE = /\\([0-9a-fA-F]{1,6})[ \t\n]?/g;
const ESCAPE = /\\([\s\S])/g;
const LAST_CODE_POINT = 0x10ffff;

/** The same rules with CSS's own escapes resolved: `@\69mport` and `\75 rl(…)`
 *  are how a look would spell either of them past a plain search. */
function spelledOut(css: string): string {
  return css
    .replace(NUMERIC_ESCAPE, (_, hex: string) => {
      const at = Number.parseInt(hex, 16);
      return at > LAST_CODE_POINT ? "" : String.fromCodePoint(at);
    })
    .replace(ESCAPE, "$1");
}

/** Whether any `url()` here loads from somewhere other than the look itself.
 *  The quotes and the space either side of a target are the author's to write
 *  or leave out, so the target is read rather than matched in place. */
function loadsFromAway(css: string): boolean {
  for (const call of css.matchAll(URL_CALL)) {
    const target = call[1].trim().replace(/^["']/, "").trim();
    if (!/^data:/i.test(target)) return true;
  }
  return false;
}

/**
 * The one line a person reads about a look whose own rules would reach the
 * network, or null where they reach nothing. A look arrives from somebody
 * else, so this gates the file AND the places the rules are applied —
 * DESIGN.md § "A look is a file" carries the rule and what it is for.
 */
export function cssIsSafe(css: string): string | null {
  const plain = spelledOut(css.replace(COMMENT, ""));
  if (IMPORTS.test(plain)) return NO_IMPORT;
  if (loadsFromAway(plain)) return NO_PICTURE;
  return null;
}

/** One of the app's own colour names. */
const PaletteTokenSchema = z
  .string()
  .regex(/^--[a-z0-9-]{1,40}$/, "A look paints the app's own colours.");

/** What one of them is painted. Bounded because these land as inline
 *  properties on the page, where a colour carrying a `;` would be a rule. */
const PaintSchema = z
  .string()
  .regex(/^[^;{}]{1,96}$/, "A look's colours have to be colours.")
  .refine((paint) => !/url\(/i.test(paint), NO_PICTURE);

const FaceSchema = z
  .string()
  .trim()
  .min(1, "A face needs a name.")
  .max(FACE_NAME_MAX, `A face's name is at most ${FACE_NAME_MAX} characters.`)
  .regex(/^[^;{}]+$/, "That is not the name of a face.");

const LookCssSchema = z
  .string()
  .max(LOOK_CSS_MAX, "That look's own styling is too long to keep.")
  .check((ctx) => {
    const reaching = cssIsSafe(ctx.value);
    if (reaching === null) return;
    ctx.issues.push({ code: "custom", input: ctx.value, message: reaching });
  });

/**
 * A look as a file — what one person sends another, and what Settings writes
 * out. Every field but the name is optional, and an ABSENT one is LEFT ALONE:
 * a look carrying only a palette changes the colours and nothing else.
 */
export const LookSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "A look needs a name.")
    .max(
      LOOK_NAME_MAX,
      `A look's name is at most ${LOOK_NAME_MAX} characters.`,
    ),
  /** The look this one is laid over, by its id. ABSENT is a look that stands
   *  on its own, and takes the app's own colours for whatever it leaves out. */
  based_on: z
    .string()
    .regex(LOOK_ID, "Sloppy has no look by that name.")
    .optional(),
  palette: z.record(PaletteTokenSchema, PaintSchema).optional(),
  style: z.enum(STYLES).optional(),
  density: z.enum(DENSITIES).optional(),
  effect: z.enum(EFFECTS).optional(),
  /** The faces the app, its headings and its code are set in. Each is a face
   *  this build offers or a family the author named, which is how a look asks
   *  for one Sloppy does not ship. */
  fonts: z
    .object({
      ui: FaceSchema.optional(),
      heading: FaceSchema.optional(),
      mono: FaceSchema.optional(),
    })
    .optional(),
  css: LookCssSchema.optional(),
  /** Everything else about how somebody keeps Sloppy, for carrying what one
   *  machine holds to another. ABSENT in a look meant for sharing, and what a
   *  present one holds is whatever the build that wrote it kept. */
  preferences: z.record(z.string(), z.unknown()).optional(),
});
export type Look = z.infer<typeof LookSchema>;
