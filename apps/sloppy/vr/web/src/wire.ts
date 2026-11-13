// What the headset hands the page and what the page says back. COMMON-E § 3 of
// the headset programme is the contract; the headset's note panel speaks it.

/** A CSS colour, or OKLCH as `[lightness 0–1, chroma, hue in degrees]`, the
 *  way the headset holds a look's colours. */
export type Colour = string | readonly number[];

/** Face names as a desk gives them (`inter`, `atkinson`, `firacode`, …);
 *  absent, `system` or one the page does not carry reads in the role's own. */
export interface Faces {
  ui?: string;
  heading?: string;
  mono?: string;
}

export interface Look {
  ink?: Colour;
  paper?: Colour;
  card?: Colour;
  edge?: Colour;
  faces?: Faces;
  /** `comfortable` or `compact`. */
  density?: string;
}

export interface Asked {
  markdown: string;
  look?: Look;
  /** What each note a citation may name is called, by ref. */
  named?: Record<string, string>;
  /** A data URI for each picture path the markdown names, as it names it. A
   *  path with none reads as the words its author gave it. */
  pictures?: Record<string, string>;
}

/** A link names a note by its ref (`note`) or by its address (`address`);
 *  neither is a link out of the graph, for the headset to decide on. */
export type Said =
  | { kind: "ready" }
  | { kind: "height"; px: number }
  | { kind: "link"; href: string; note?: string; address?: string };
