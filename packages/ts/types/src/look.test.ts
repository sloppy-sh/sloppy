import { describe, expect, it } from "vitest";
import {
  cssIsSafe,
  DENSITIES,
  EFFECTS,
  FACE_NAME_MAX,
  LOOK_CSS_MAX,
  LOOK_NAME_MAX,
  LookSchema,
  namesAFace,
  STYLES,
} from "./look.js";

const look = (fields: Record<string, unknown>) =>
  LookSchema.safeParse({ name: "Midnight Ink", ...fields });

/** The one line a refused look says, where it is refused for one reason. */
function refusal(fields: Record<string, unknown>): string {
  const parsed = look(fields);
  if (parsed.success) throw new Error("that look was not refused");
  return parsed.error.issues.map((issue) => issue.message).join(" / ");
}

describe("a look somebody was sent", () => {
  it("is a look with nothing but a name", () => {
    expect(LookSchema.parse({ name: "Midnight Ink" })).toEqual({
      name: "Midnight Ink",
    });
  });

  it("needs a name, and a name somebody could read", () => {
    expect(LookSchema.safeParse({}).success).toBe(false);
    expect(look({}).success).toBe(true);
    expect(LookSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(LookSchema.parse({ name: "  Midnight Ink  " }).name).toBe(
      "Midnight Ink",
    );
    expect(
      LookSchema.safeParse({ name: "x".repeat(LOOK_NAME_MAX) }).success,
    ).toBe(true);
    expect(
      LookSchema.safeParse({ name: "x".repeat(LOOK_NAME_MAX + 1) }).success,
    ).toBe(false);
  });

  it("stands on a look named the way a look is named, or on nothing", () => {
    expect(look({ based_on: "catppuccin-mocha" }).success).toBe(true);
    expect(look({ based_on: "paper" }).success).toBe(true);
    expect(look({ based_on: "Not A Slug!" }).success).toBe(false);
    expect(look({ based_on: "-leading-dash" }).success).toBe(false);
  });

  it("paints the app's own colours, and paints them colours", () => {
    expect(
      look({ palette: { "--background": "oklch(.17 .02 265)" } }).success,
    ).toBe(true);
    expect(look({ palette: { background: "red" } }).success).toBe(false);
    expect(
      look({ palette: { "--background": "red; position: fixed" } }).success,
    ).toBe(false);
    expect(look({ palette: { "--background": "x".repeat(97) } }).success).toBe(
      false,
    );
    expect(look({ palette: {} }).success).toBe(true);
  });

  // The palette lands inline on the page, so a picture reaching the web would
  // reach it from there as readily as from a rule.
  it("paints no colour that loads a picture from the web", () => {
    expect(
      refusal({ palette: { "--background": "url(https://a.example/p.png)" } }),
    ).toContain("cannot load anything from the web");
    expect(
      refusal({
        palette: { "--background": 'image-set("https://a.example/p.png")' },
      }),
    ).toContain("cannot load anything from the web");
  });

  it("takes the axes the app itself offers, and nothing else", () => {
    for (const style of STYLES) expect(look({ style }).success).toBe(true);
    for (const density of DENSITIES)
      expect(look({ density }).success).toBe(true);
    for (const effect of EFFECTS) expect(look({ effect }).success).toBe(true);
    expect(look({ style: "sketch" }).success).toBe(false);
    expect(look({ density: "roomy" }).success).toBe(false);
    expect(look({ effect: "glow" }).success).toBe(false);
  });

  // A look names a family this build does not ship — that is how it asks for
  // one the machine might have — so only the bound is held.
  it("names three faces, by name rather than by rule", () => {
    expect(
      look({
        fonts: {
          ui: "Inter",
          heading: "Iosevka Etoile",
          mono: "JetBrains Mono",
        },
      }).success,
    ).toBe(true);
    expect(look({ fonts: { heading: "Iosevka Etoile" } }).success).toBe(true);
    expect(look({ fonts: {} }).success).toBe(true);
    expect(look({ fonts: { ui: "Inter; position: fixed" } }).success).toBe(
      false,
    );
    expect(look({ fonts: { ui: "x".repeat(FACE_NAME_MAX) } }).success).toBe(
      true,
    );
    expect(look({ fonts: { ui: "x".repeat(FACE_NAME_MAX + 1) } }).success).toBe(
      false,
    );
  });

  // One bound on a face, so a look naming one the store would not keep is
  // turned down here rather than read and quietly ignored there.
  it("holds a face to the one bound a kept face is held to", () => {
    for (const named of [
      "Inter",
      "Iosevka Etoile",
      "x".repeat(FACE_NAME_MAX),
      " Inter ",
    ]) {
      expect(namesAFace(named), named).toBe(true);
      expect(look({ fonts: { ui: named } }).success, named).toBe(true);
    }
    for (const named of [
      "",
      "   ",
      "Inter; position: fixed",
      "url(https://a.example/f.woff2)",
      "Inter{",
      "In\u0000ter",
      "x".repeat(FACE_NAME_MAX + 1),
    ]) {
      expect(namesAFace(named), named).toBe(false);
      expect(look({ fonts: { ui: named } }).success, named).toBe(false);
    }
  });

  it("carries rules of its own, up to what a look runs to", () => {
    const rules = ".sloppy-prose h2 { letter-spacing: .02em }";
    expect(LookSchema.parse({ name: "n", css: rules }).css).toBe(rules);
    expect(look({ css: "a".repeat(LOOK_CSS_MAX) }).success).toBe(true);
    expect(look({ css: "a".repeat(LOOK_CSS_MAX + 1) }).success).toBe(false);
  });

  it("carries what one machine keeps without this build naming any of it", () => {
    expect(
      look({ preferences: { walking: true, autosaveMinutes: 15, later: "?" } })
        .success,
    ).toBe(true);
  });

  // A look is read by builds that did not write it, so a field from a later
  // Sloppy costs that field rather than the look.
  it("parses when it carries a field this build has no use for", () => {
    expect(LookSchema.parse({ name: "n", wallpaper: "a.png" })).toEqual({
      name: "n",
    });
  });
});

describe("a look that would reach the network", () => {
  it("is let through where its rules reach nothing", () => {
    expect(cssIsSafe("")).toBeNull();
    expect(cssIsSafe(".sloppy-prose h2 { letter-spacing: .02em }")).toBeNull();
    expect(
      cssIsSafe("/* url(https://a.example/p.png) */ h2 { margin: 0 }"),
    ).toBeNull();
    // A string is read as a string, which is why the word in one is just a word.
    expect(cssIsSafe('h2::after { content: "@import" }')).toBeNull();
  });

  it("may still draw a picture it carries itself", () => {
    expect(
      cssIsSafe("h2 { background: url(data:image/gif;base64,R0lGOD) }"),
    ).toBeNull();
    expect(
      cssIsSafe("h2 { background: url( 'data:image/gif;base64,R0' ) }"),
    ).toBeNull();
    expect(
      cssIsSafe('h2 { background: url("DATA:image/gif;base64,R0") }'),
    ).toBeNull();
  });

  it("is turned down for an @import, however it is spelt", () => {
    for (const rules of [
      "@import 'https://a.example/x.css';",
      "@IMPORT url(https://a.example/x.css);",
      "@ import 'x.css';",
      "/* nothing to see */@import 'x.css';",
      "@\\69mport 'x.css';",
      "@\\import 'x.css';",
    ]) {
      expect(cssIsSafe(rules), rules).toBe(
        "A look cannot load anything from the web. Take out the @import.",
      );
    }
  });

  it("is turned down for a picture it loads from the web", () => {
    for (const rules of [
      "h2 { background: url(https://a.example/p.png) }",
      "h2 { background: url('//a.example/p.png') }",
      'h2 { background: URL( "http://a.example/p.png" ) }',
      "/* data: */h2 { background: url(https://a.example/p.png) }",
      "h2 { background: \\75 rl(https://a.example/p.png) }",
      "@font-face { src: url(https://a.example/f.woff2) }",
    ]) {
      expect(cssIsSafe(rules), rules).toBe(
        "A look cannot load anything from the web. Take out the web address.",
      );
    }
  });

  // The delimiters are in strings, where CSS does not read them as delimiters:
  // a gate that cut from the first `/*` to the last `*/` would cut the live
  // declaration between them and let the browser fetch what it left behind.
  it("is turned down for what it holds between string-borne delimiters", () => {
    expect(
      cssIsSafe(
        'h2 { content: "/*"; background: url(https://a.example/p.png); content: "*/" }',
      ),
    ).toBe(
      "A look cannot load anything from the web. Take out the web address.",
    );
    expect(
      cssIsSafe(
        'h2 { content: "/*" } @import "https://a.example/x.css"; h2 { content: "*/" }',
      ),
    ).toBe("A look cannot load anything from the web. Take out the @import.");
  });

  // `image-set()` and `src()` take a bare string for a URL, so a gate searching
  // for `url(` alone would miss every picture they load.
  it("is turned down for a picture a function loads by name", () => {
    for (const rules of [
      'a { background: image-set("https://a.example/p.png" 1x) }',
      'a { background: -webkit-image-set("//a.example/p.png" 1x) }',
      '@font-face { src: local("X"), url("https://a.example/f.woff2") }',
      '@font-face { src: src("https://a.example/f.woff2") }',
      'a { background: image-set("https:\\2f\\2f a.example/p.png" 1x) }',
    ]) {
      expect(cssIsSafe(rules), rules).toBe(
        "A look cannot load anything from the web. Take out the web address.",
      );
    }
  });

  it("may still have one of those draw a picture it carries itself", () => {
    expect(
      cssIsSafe('a { background: image-set("data:image/gif;base64,R0" 1x) }'),
    ).toBeNull();
  });

  // The gate is on the look as well as on the place the rules are applied, so
  // a look carrying either never lands anywhere.
  // A special scheme resolves to a host with or without its slashes, so the
  // gate reads the scheme rather than the slashes.
  it("is turned down for an address whose scheme carries no slashes", () => {
    for (const rules of [
      "body { background-image: url(https:example.com/paper.png) }",
      '@font-face { src: "https:example.com/a.woff2" }',
      '.a { background-image: image-set("HTTPS:example.com/a.png" 1x) }',
    ]) {
      expect(cssIsSafe(rules)).not.toBeNull();
    }
  });

  // What is left after the schemes and the slashes names this page or what
  // served it, which is not the web.
  it("lets a look point at itself, at the page, and at what served it", () => {
    for (const rules of [
      ".a { clip-path: url(#a-shape) }",
      ".a { background-image: url(./paper.png) }",
      ".a { background-image: url(paper.png) }",
      '.a { filter: url("#blur") }',
    ]) {
      expect(cssIsSafe(rules)).toBeNull();
    }
  });

  it("is refused as a file for the same two, in the line a person reads", () => {
    expect(refusal({ css: "@import 'https://a.example/x.css';" })).toBe(
      "A look cannot load anything from the web. Take out the @import.",
    );
    expect(
      refusal({ css: "h2 { background: url(https://a.example/p.png) }" }),
    ).toBe(
      "A look cannot load anything from the web. Take out the web address.",
    );
  });
});
