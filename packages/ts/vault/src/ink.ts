// A drawing as an SVG. The strokes beside it in `.sloppy/ink/` are the record;
// this is what a reader that has never heard of Sloppy shows —
// docs/ARCHITECTURE.md § "A graph on disk".

import { type InkStroke, InkElementDataSchema } from "@sloppy/types";

const WITHOUT_STROKES = { strokes: [] as InkStroke[], width: 600, height: 200 };

function rounded(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function path(stroke: InkStroke): string {
  const [first, ...rest] = stroke.points;
  const drawn = [`M ${rounded(first.x)} ${rounded(first.y)}`];
  for (const point of rest)
    drawn.push(`L ${rounded(point.x)} ${rounded(point.y)}`);
  return drawn.join(" ");
}

function xml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Attributes that are not a drawing this build can read still get a picture,
 *  so the link beside them is never dead. */
export function inkSvg(attrs: unknown): string {
  const read = InkElementDataSchema.safeParse(attrs);
  const drawing = read.success ? read.data : WITHOUT_STROKES;
  const strokes = drawing.strokes
    .filter((stroke) => stroke.points.length > 0)
    .map(
      (stroke) =>
        `  <path d="${path(stroke)}" fill="none" stroke="#111111" stroke-width="${rounded(stroke.width)}" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
  const description = read.success ? read.data.description : null;
  const described =
    typeof description === "string" && description !== ""
      ? `  <title>${xml(description)}</title>\n`
      : "";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${rounded(drawing.width)} ${rounded(drawing.height)}" width="${rounded(drawing.width)}" height="${rounded(drawing.height)}">`,
    described + strokes.join("\n"),
    "</svg>",
    "",
  ].join("\n");
}
