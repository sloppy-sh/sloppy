// What a search asks the store, and what a hit shows of the answer.

import type { OwnedRef, SearchHit } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import {
  bestFirst,
  notesAmong,
  type SectionMatch,
  searchWords,
  snippetAround,
} from "./search";

const ADA = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva";
const ONE = `${ADA}/01JWRDSA000000000000000000` as OwnedRef;
const TWO = `${ADA}/01JWRDSB000000000000000000` as OwnedRef;

const section = (note: OwnedRef, text: string, at: number[]): SectionMatch => ({
  note,
  text,
  at,
});

describe("the words a search asks for", () => {
  it("keeps the words and drops what is not one", () => {
    expect(searchWords("  mushrooms?! ")).toBe("mushrooms");
    expect(searchWords("seeds, and rain")).toBe("seeds and rain");
  });

  it("keeps a number, which is as much a word as any", () => {
    expect(searchWords("chapter 12")).toBe("chapter 12");
  });

  it("keeps writing that is not written in English", () => {
    expect(searchWords("forêts, café")).toBe("forêts café");
  });

  it("answers nothing where nothing was asked", () => {
    expect(searchWords("   ")).toBe("");
    expect(searchWords("???")).toBe("");
  });
});

describe("the notes a set of matched sections belongs to", () => {
  it("counts every match across the sections of one note", () => {
    const found = notesAmong([
      section(ONE, "mushroom and mushroom", [0, 14]),
      section(ONE, "mushroom again", [0]),
      section(TWO, "mushroom once", [0]),
    ]);

    expect(found.get(ONE)?.matches).toBe(3);
    expect(found.get(TWO)?.matches).toBe(1);
  });

  it("shows the writing from the section that carries the words most often", () => {
    const found = notesAmong([
      section(ONE, "one passing mention", [4]),
      section(ONE, "said twice, said twice", [0, 12]),
    ]);

    expect(found.get(ONE)?.snippet).toBe("said twice, said twice");
  });

  it("shows nothing for a section the store matched without saying where", () => {
    expect(
      notesAmong([section(ONE, "somewhere in here", [])]).get(ONE),
    ).toEqual({ matches: 0, snippet: "" });
  });
});

describe("the writing a hit shows", () => {
  const long = (around: string) =>
    `${"filler ".repeat(30)}${around}${" filler".repeat(30)}`;

  it("shows a short section whole", () => {
    expect(snippetAround("seeds and mushrooms", 10)).toBe(
      "seeds and mushrooms",
    );
  });

  it("cuts around the match, and says it cut", () => {
    const text = long("mushrooms");
    const shown = snippetAround(text, text.indexOf("mushrooms"));

    expect(shown).toContain("mushrooms");
    expect(shown.startsWith("…")).toBe(true);
    expect(shown.endsWith("…")).toBe(true);
    expect(shown.length).toBeLessThan(180);
  });

  it("does not open with half a word", () => {
    const text = long("mushrooms");
    const shown = snippetAround(text, text.indexOf("mushrooms"));

    expect(shown.slice(1).startsWith("filler")).toBe(true);
    expect(shown.slice(0, -1).endsWith("filler")).toBe(true);
  });

  it("starts at the beginning where the match is near it", () => {
    const text = `mushrooms ${"filler ".repeat(60)}`;
    expect(snippetAround(text, 0).startsWith("mushrooms")).toBe(true);
  });

  it("counts what it cuts in characters, not in bytes", () => {
    const text = `${"forêt ".repeat(40)}mushrooms${" forêt".repeat(40)}`;
    const shown = snippetAround(text, [...text].indexOf("m"));

    expect(shown).toContain("mushrooms");
  });
});

describe("which hit a person reads first", () => {
  const hit = (address: string, note: OwnedRef): SearchHit => ({
    note,
    address,
    graph: `${ADA}/00000000000000000000000000` as OwnedRef,
    title: address,
    snippet: "",
    held: false,
  });

  it("puts what the words are in most often first", () => {
    const ranked = [
      { hit: hit("1", ONE), matches: 1 },
      { hit: hit("2", TWO), matches: 4 },
    ].sort(bestFirst);

    expect(ranked.map((one) => one.hit.address)).toEqual(["2", "1"]);
  });

  it("reads a tie by the address, so one search answers the same way twice", () => {
    const ranked = [
      { hit: hit("1b", TWO), matches: 2 },
      { hit: hit("1a", ONE), matches: 2 },
    ].sort(bestFirst);

    expect(ranked.map((one) => one.hit.address)).toEqual(["1a", "1b"]);
  });
});
