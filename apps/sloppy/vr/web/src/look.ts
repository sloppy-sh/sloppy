import type { Colour, Look } from "./wire";

/** Sloppy's first look, worn until the headset says another. */
const PAPER: Required<Pick<Look, "ink" | "paper" | "card" | "edge">> = {
  paper: [0.972, 0.006, 85],
  ink: [0.26, 0.015, 70],
  card: [0.987, 0.005, 85],
  edge: [0.895, 0.008, 85],
};

/** The family each face the page carries is declared under in faces.css. */
const FAMILIES: Record<string, string> = {
  inter: "Inter",
  atkinson: "Atkinson Hyperlegible",
  opendyslexic: "OpenDyslexic",
  firacode: "Fira Code",
  cascadiacode: "Cascadia Code",
  victormono: "Victor Mono",
  iosevka: "Iosevka",
  jetbrainsmono: "JetBrains Mono",
};
const ROLE_FACES = { ui: "inter", heading: "inter", mono: "jetbrainsmono" };
/** The device's own face. */
const DEVICE_FACE = "apple";
const SYSTEM = "system-ui, sans-serif";
const MONO_FALLBACK = "ui-monospace, monospace";

const CLOSENESS: Record<string, number> = { comfortable: 1, compact: 0.6 };

/** `colour` as CSS, or undefined where it is neither a colour nor an OKLCH
 *  triple; nothing that could close the declaration it is written into. */
export function cssColour(colour: Colour | undefined): string | undefined {
  if (Array.isArray(colour)) {
    const [l, c, h] = colour;
    if (![l, c, h].every((n) => typeof n === "number" && Number.isFinite(n)))
      return undefined;
    return `oklch(${l} ${c} ${h})`;
  }
  if (typeof colour !== "string") return undefined;
  const said = colour.trim();
  return said === "" || /[;{}<>\\"']/.test(said) ? undefined : said;
}

/** How light `colour` is, 0 to 1, where it can be read without a renderer. */
export function lightness(colour: Colour | undefined): number | undefined {
  if (Array.isArray(colour)) {
    return typeof colour[0] === "number" ? colour[0] : undefined;
  }
  if (typeof colour !== "string") return undefined;
  const said = colour.trim().toLowerCase();
  const oklch = /^oklch\(\s*([0-9.]+)(%?)/.exec(said);
  if (oklch) return Number(oklch[1]) / (oklch[2] ? 100 : 1);
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(said);
  if (hex) {
    const digits =
      hex[1].length === 3
        ? [...hex[1]].map((d) => d + d)
        : hex[1].match(/../g)!;
    return luminance(digits.map((d) => Number.parseInt(d, 16)));
  }
  const rgb = /^rgba?\(\s*([0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)/.exec(said);
  if (rgb) return luminance([rgb[1], rgb[2], rgb[3]].map(Number));
  return undefined;
}

function luminance([r, g, b]: number[]): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function family(face: string | undefined, role: keyof typeof ROLE_FACES) {
  const fallback = role === "mono" ? MONO_FALLBACK : SYSTEM;
  if (face === DEVICE_FACE) return fallback;
  const named = FAMILIES[face ?? ""] ?? FAMILIES[ROLE_FACES[role]];
  return `"${named}", ${fallback}`;
}

/** The custom properties page.css draws with, for `look`. */
export function lookProperties(look: Look = {}): Record<string, string> {
  const colour = (key: keyof typeof PAPER) =>
    cssColour(look[key]) ?? cssColour(PAPER[key])!;
  return {
    "--ink": colour("ink"),
    "--paper": colour("paper"),
    "--card": colour("card"),
    "--edge": colour("edge"),
    "--face-ui": family(look.faces?.ui, "ui"),
    "--face-heading": family(look.faces?.heading, "heading"),
    "--face-mono": family(look.faces?.mono, "mono"),
    "--closeness": String(CLOSENESS[look.density ?? ""] ?? 1),
  };
}

/** Whether `look` is ink on a dark ground, which decides the code's colours. */
export function isDark(look: Look = {}): boolean {
  return (lightness(look.paper) ?? lightness(PAPER.paper)!) < 0.5;
}
