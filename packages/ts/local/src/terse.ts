// The terse answer a caller served with `answers: "terse"` reads: the same facts an act
// answers with, spelled shorter — docs/ARCHITECTURE.md § "An assistant outside
// the app".

/** The keys an answer's facts are spelled with, by the key the app's own chat
 *  reads. A key not here keeps its own. */
const KEYS: Readonly<Record<string, string>> = {
  note: "ref",
  address: "at",
  parent: "up",
  about: "on",
  sections: "text",
  headings: "heads",
  around: "near",
  relation: "rel",
  depth: "hops",
  snippet: "around",
  section: "in",
  links: "lines",
  edges: "looks",
};

/** What an answer lists, which says something even where it is empty. */
const LISTINGS = new Set([
  "found",
  "notes",
  "around",
  "tags",
  "bin",
  "offers",
  "parents",
  "links",
]);

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Terse answers name a note in the graph `home` owns by its ULID alone; a call
 * naming one so is read as the ref it stands for. Everything else in the
 * arguments is as it came.
 */
export function refsWidened(given: unknown, home: string | undefined): unknown {
  if (home === undefined) return given;
  const widen = (held: unknown): unknown => {
    if (typeof held === "string") {
      return ULID.test(held) ? `${home}/${held}` : held;
    }
    if (Array.isArray(held)) return held.map(widen);
    if (held !== null && typeof held === "object") {
      return Object.fromEntries(
        Object.entries(held).map(([key, value]) => [key, widen(value)]),
      );
    }
    return held;
  };
  return widen(given);
}

/** An act's answer as a terse one: JSON respelled by {@link terseValue}, and
 *  words left as they are. */
export function terseAnswer(said: string, home: string | undefined): string {
  let held: unknown;
  try {
    held = JSON.parse(said);
  } catch {
    return said;
  }
  if (held === null || typeof held !== "object") return said;
  return JSON.stringify(terseValue(held, home));
}

/**
 * The same facts in fewer characters: short keys, a ref in `home`'s graph as
 * its ULID, a section as its markdown without emphasis or link targets into
 * code, a place in the code as one string with where it stands, a place `code`
 * already names left out of `about`, and nothing empty.
 */
export function terseValue(held: unknown, home: string | undefined): unknown {
  const short = (text: string): string =>
    home === undefined ? text : text.split(`${home}/`).join("");
  const walk = (value: unknown, key?: string): unknown => {
    if (typeof value === "string") return short(value);
    if (Array.isArray(value)) {
      if (key === "sections") return value.map(sectionText);
      if (key === "anchors") return value.map(standingText);
      if (key === "quoted") return value.map(quoteText);
      if (key === "outline") return value.map(outlinedText);
      return value.map((one) => walk(one));
    }
    if (value === null || typeof value !== "object") return value;
    const given = value as Record<string, unknown>;
    const code = Array.isArray(given.code) ? (given.code as string[]) : [];
    const object = placesStanding(given);
    const out: Record<string, unknown> = {};
    for (const [field, inside] of Object.entries(object)) {
      const kept =
        field === "about" && Array.isArray(inside)
          ? inside.filter((path) => !named(code, String(path)))
          : inside;
      if (empty(kept) && !(given === top && LISTINGS.has(field))) continue;
      out[KEYS[field] ?? field] = walk(kept, field);
    }
    return out;
  };
  const sectionText = (section: unknown): string =>
    short(stripped(String((section as { markdown?: unknown }).markdown ?? "")));
  const top = held;
  return walk(held);
}

/** Where the code under one anchor stands, as one string. */
function standingText(anchor: unknown): string {
  const { path, fragment, standing } = anchor as {
    path: string;
    fragment?: string;
    standing: string;
  };
  return `${path}${fragment === undefined ? "" : `#${fragment}`} ${standing}`;
}

/** A section an outline names, as one string: its heading and its size. */
function outlinedText(section: unknown): string {
  const { heading, size } = section as { heading: string; size: number };
  return `${heading} (${size})`;
}

/** Where the code under one quote stands, as one string: where it was, its
 *  state, where it is now, and on a line of their own what changed lines say. */
function quoteText(quote: unknown): string {
  const { at, state, now, says } = quote as {
    at: string;
    state: string;
    now?: string;
    says?: string;
  };
  const line = `${at} ${state}${now === undefined ? "" : ` ${now}`}`;
  return says === undefined ? line : `${line}\n${says}`;
}

/** A note whose `code` names the lines of each of its `anchors`, with where
 *  each stands written after its lines and the anchors themselves left out. */
function placesStanding(
  object: Record<string, unknown>,
): Record<string, unknown> {
  const { anchors, code } = object;
  if (
    !Array.isArray(anchors) ||
    !Array.isArray(code) ||
    anchors.length !== code.length
  ) {
    return object;
  }
  const { anchors: _, ...rest } = object;
  return {
    ...rest,
    code: code.map(
      (place, at) =>
        `${place} ${(anchors[at] as { standing?: unknown }).standing}`,
    ),
  };
}

function named(code: readonly string[], path: string): boolean {
  return code.some(
    (place) =>
      place === path || place === `${path}/` || place.startsWith(`${path}#`),
  );
}

function empty(value: unknown): boolean {
  return (
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

/**
 * A section's markdown without what only draws it: emphasis, a link's target
 * where it points into the code (whose lines `code` names), an image's address,
 * blank lines run together and the dashes of a table's rule. What is inside a
 * fence is left exactly as written.
 */
export function stripped(markdown: string): string {
  const out: string[] = [];
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced || /^\s*(```|~~~)/.test(line)) {
      out.push(line);
      continue;
    }
    const plain = line
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "[image: $1]")
      .replace(/\[([^\]]+)\]\(code:[^)]*\)/g, "$1")
      .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, "$2")
      .replace(/\\([\\`*_{}[\]()#+\-.!:~|<>])/g, "$1")
      .replace(/^(\s*\|)(\s*:?-+:?\s*\|)+\s*$/, (rule) =>
        rule.replace(/\s*:?-+:?\s*/g, "-"),
      )
      .trimEnd();
    if (plain === "" && out[out.length - 1] === "") continue;
    out.push(plain);
  }
  return out.join("\n").trim();
}
