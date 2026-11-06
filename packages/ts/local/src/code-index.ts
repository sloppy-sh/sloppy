// Where something is in a project's code: its files and what they define,
// ranked against a name or a few words — docs/ARCHITECTURE.md § "An assistant
// outside the app". Built from the files whenever it is asked for, never kept
// in the container.

import type { CodeKind } from "@sloppy/types";
import type { CodeSymbol } from "./code-symbols.js";

/** One file of the project and what it defines. */
export interface CodeFile {
  /** From the project root, spelled with `/`. */
  path: string;
  symbols: readonly CodeSymbol[];
}

/** One place some words reached, best first. `from` and `to` are absent on a
 *  file. */
export interface CodeHit {
  path: string;
  kind: CodeKind;
  name?: string;
  from?: number;
  to?: number;
}

export interface CodeIndex {
  files: readonly CodeFile[];
  /** Per document: its file, and its symbol in that file or -1 for the file. */
  file: Int32Array;
  symbol: Int32Array;
  length: Float64Array;
  meanLength: number;
  /** Per word: the documents carrying it, each as `[document, weight]`. */
  postings: Map<string, number[]>;
  /** Per lowercase name: the documents defining it. */
  named: Map<string, number[]>;
}

/** How much a word in a definition's name counts against one in its path. */
const NAME_WEIGHT = 3;
const K1 = 1.2;
const B = 0.75;

/** What a place in the tests is worth beside one in the code they test, unless
 *  the words ask for tests. */
const TEST_WORTH = 0.6;

/** Defined more often than this, a name says little about any one place it is
 *  defined — a namespace reopened in every file under it — and each is worth
 *  that many over how often, down to {@link LEAST_COMMON_WORTH}. */
const COMMON_NAME = 20;
const LEAST_COMMON_WORTH = 0.1;

/** More places of one file than one answer names. */
const MOST_PER_FILE = 2;

const SAYS_NOTHING = new Set(
  "a an and are be by do does for from how in is it of on or that the this to what when where which who why with".split(
    " ",
  ),
);

/**
 * The words an identifier or a path is made of, lowercase: split at `_`, `-`,
 * `/`, `.` and every change of case, each with a trailing plural `s` left off,
 * and a name written in several cases whole beside its parts.
 */
export function identifierWords(text: string): string[] {
  const words: string[] = [];
  for (const piece of text.split(/[^A-Za-z0-9$]+/)) {
    if (piece === "") continue;
    const parts =
      piece.match(/[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|[0-9]+/g) ?? [];
    for (const part of parts) words.push(stem(part.toLowerCase()));
    if (parts.length > 1) words.push(stem(piece.toLowerCase()));
  }
  return words;
}

function stem(word: string): string {
  return word.length > 3 && word.endsWith("s") && !word.endsWith("ss")
    ? word.slice(0, -1)
    : word;
}

/** The project's code as one index. */
export function codeIndexOf(files: readonly CodeFile[]): CodeIndex {
  const docFile: number[] = [];
  const docSymbol: number[] = [];
  const lengths: number[] = [];
  const postings = new Map<string, number[]>();
  const named = new Map<string, number[]>();
  const add = (doc: number, weights: Map<string, number>) => {
    let length = 0;
    for (const [word, weight] of weights) {
      length += weight;
      const list = postings.get(word);
      if (list) list.push(doc, weight);
      else postings.set(word, [doc, weight]);
    }
    lengths.push(length);
  };
  files.forEach((file, at) => {
    const pathWords = identifierWords(file.path);
    const doc = docFile.length;
    docFile.push(at);
    docSymbol.push(-1);
    add(doc, counted(pathWords, 1));
    file.symbols.forEach((symbol, which) => {
      const doc = docFile.length;
      docFile.push(at);
      docSymbol.push(which);
      const weights = counted(pathWords, 1);
      for (const word of identifierWords(symbol.name)) {
        weights.set(word, (weights.get(word) ?? 0) + NAME_WEIGHT);
      }
      add(doc, weights);
      const name = symbol.name.toLowerCase();
      const list = named.get(name);
      if (list) list.push(doc);
      else named.set(name, [doc]);
    });
  });
  const total = lengths.reduce((sum, one) => sum + one, 0);
  return {
    files,
    file: Int32Array.from(docFile),
    symbol: Int32Array.from(docSymbol),
    length: Float64Array.from(lengths),
    meanLength: lengths.length === 0 ? 1 : total / lengths.length,
    postings,
    named,
  };
}

function counted(
  words: readonly string[],
  weight: number,
): Map<string, number> {
  const held = new Map<string, number>();
  for (const word of words) held.set(word, (held.get(word) ?? 0) + weight);
  return held;
}

/**
 * The places `words` reach, best first and at most `limit`: a definition
 * named exactly as one of the words before anything else — spelled the same
 * case before another — then by how much of the words its name and path carry,
 * a word counting for more the fewer places carry it. A file is named once its
 * own definitions are not, and no file more than twice.
 */
export function codeFound(
  index: CodeIndex,
  words: string,
  limit: number,
): CodeHit[] {
  const asked = [
    ...new Set(identifierWords(words).filter((one) => !SAYS_NOTHING.has(one))),
  ];
  const scores = new Map<number, number>();
  const documents = index.file.length;
  for (const word of asked) {
    const list = index.postings.get(word);
    if (!list) continue;
    const carrying = list.length / 2;
    const idf = Math.log(1 + (documents - carrying + 0.5) / (carrying + 0.5));
    for (let at = 0; at < list.length; at += 2) {
      const doc = list[at] as number;
      const weight = list[at + 1] as number;
      const norm =
        1 - B + (B * (index.length[doc] as number)) / index.meanLength;
      const part = (idf * weight * (K1 + 1)) / (weight + K1 * norm);
      scores.set(doc, (scores.get(doc) ?? 0) + part);
    }
  }
  const exact = exactlyNamed(index, words);
  const wantsTests = asked.some((one) => one === "test" || one === "spec");
  const ranked = [...new Set([...exact.keys(), ...scores.keys()])]
    .map((doc) => {
      const file = index.files[index.file[doc] as number] as CodeFile;
      const symbol = file.symbols[index.symbol[doc] as number];
      const defined =
        symbol === undefined
          ? 1
          : (index.named.get(symbol.name.toLowerCase())?.length ?? 1);
      const worth =
        (scores.get(doc) ?? 0) *
        (!wantsTests && isTest(file.path) ? TEST_WORTH : 1) *
        Math.max(LEAST_COMMON_WORTH, Math.min(1, COMMON_NAME / defined));
      return { doc, exact: exact.get(doc) ?? 0, worth };
    })
    .sort((a, b) => b.exact - a.exact || b.worth - a.worth || a.doc - b.doc);
  const perFile = new Map<number, number>();
  const hits: CodeHit[] = [];
  for (const { doc } of ranked) {
    if (hits.length >= limit) break;
    const file = index.file[doc] as number;
    const symbol = index.symbol[doc] as number;
    const taken = perFile.get(file) ?? 0;
    if (taken >= MOST_PER_FILE || (symbol === -1 && taken > 0)) continue;
    perFile.set(file, symbol === -1 ? MOST_PER_FILE : taken + 1);
    hits.push(hitOf(index, file, symbol));
  }
  return hits;
}

/**
 * The documents defining a name the words spell whole, 2 where the case is the
 * same and 1 where only the letters are. A word counts where it is spelled
 * like a name in code — `parseSource`, `merge_service`, `ready?` — or is all
 * the words there are, so an ordinary word in a sentence is ranked like the
 * rest of it; a name defined in many places points at none of them.
 */
function exactlyNamed(index: CodeIndex, words: string): Map<number, number> {
  const found = new Map<number, number>();
  const spelled = words.match(/[A-Za-z_$][\w$]*[?!]?/g) ?? [];
  for (const word of spelled) {
    if (word.length < 3 || (spelled.length > 1 && !looksLikeCode(word))) {
      continue;
    }
    const defining = index.named.get(word.toLowerCase()) ?? [];
    if (defining.length > COMMON_NAME) continue;
    for (const doc of defining) {
      const file = index.files[index.file[doc] as number] as CodeFile;
      const symbol = file.symbols[index.symbol[doc] as number] as CodeSymbol;
      const same = symbol.name === word ? 2 : 1;
      found.set(doc, Math.max(found.get(doc) ?? 0, same));
    }
  }
  return found;
}

function looksLikeCode(word: string): boolean {
  return /[a-z0-9][A-Z]|[A-Z]{2}|_|[?!$0-9]|^[A-Z]/.test(word);
}

const TEST_PATH =
  /(?:^|\/)(?:tests?|specs?|__tests__|__mocks__|fixtures?|testdata|qa)\/|[._-](?:test|spec)\.[^/]+$|_test\.go$|(?:^|\/)test_[^/]+\.py$/;

function isTest(path: string): boolean {
  return TEST_PATH.test(path);
}

function hitOf(index: CodeIndex, file: number, symbol: number): CodeHit {
  const held = index.files[file] as CodeFile;
  if (symbol === -1) return { path: held.path, kind: "file" };
  const { name, kind, from, to } = held.symbols[symbol] as CodeSymbol;
  return { path: held.path, kind, name, from, to };
}

/** A hit as the place it names: `path#L<from>-L<to>`, or the path alone. */
export function placeOf(hit: CodeHit): string {
  if (hit.from === undefined || hit.to === undefined) return hit.path;
  return hit.from === hit.to
    ? `${hit.path}#L${hit.from}`
    : `${hit.path}#L${hit.from}-L${hit.to}`;
}

/** The index of the project rooted at `root`, as a surface that can read its
 *  code builds it. */
export type CodeReader = (root: string) => Promise<CodeIndex>;
