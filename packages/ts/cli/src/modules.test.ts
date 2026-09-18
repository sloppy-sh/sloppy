import { describe, expect, it } from "vitest";
import { readModule, readsModule } from "./modules.js";

describe("what a module says about itself", () => {
  it("reads what it reaches for", () => {
    const facts = readModule(
      "a/b.ts",
      [
        'import { one } from "./one.js";',
        'import type { Two } from "../two/index.js";',
        'import "./side-effect.js";',
        'export { three } from "./three.js";',
        'const four = require("node:fs");',
        'const said = "not an import: ./nope.js";',
      ].join("\n"),
    );
    expect(facts.read).toBe(true);
    expect(facts.imports).toEqual([
      "./one.js",
      "../two/index.js",
      "./side-effect.js",
      "./three.js",
      "node:fs",
    ]);
  });

  it("reads what it hands out, by the name it hands it out under", () => {
    const facts = readModule(
      "a/b.ts",
      [
        "export function one() {}",
        "export async function two() {}",
        "export class Three {}",
        "export const four = 4;",
        "export interface Five { a: string }",
        "export type Six = string;",
        "export enum Seven { a }",
        "export default function () {}",
        "export { eight, nine as ten };",
        "export {",
        "  eleven,",
        "  type Twelve as Thirteen,",
        "};",
        "function hidden() {}",
        "const alsoHidden = 1;",
      ].join("\n"),
    );
    expect(facts.exports).toEqual([
      "one",
      "two",
      "Three",
      "four",
      "Five",
      "Six",
      "Seven",
      "default",
      "eight",
      "ten",
      "eleven",
      "Thirteen",
    ]);
  });

  it("takes a re-export's source as something it reaches for", () => {
    const facts = readModule("a/b.ts", 'export * from "./all.js";');
    expect(facts.imports).toEqual(["./all.js"]);
    expect(facts.exports).toEqual([]);
  });

  it("takes apart no language it cannot read by the line", () => {
    expect(readsModule("src/main.rs")).toBe(false);
    expect(readsModule("src/index.ts")).toBe(true);
    expect(readsModule("Makefile")).toBe(false);
    const facts = readModule("src/main.rs", "pub fn main() {}\nuse std::fs;");
    expect(facts).toEqual({ read: false, imports: [], exports: [] });
  });
});
