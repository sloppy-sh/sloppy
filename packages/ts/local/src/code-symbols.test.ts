// What a file in the project defines, found line by line.

import { describe, expect, it } from "vitest";
import { readsDefinitions, symbolsIn } from "./code-symbols.js";

const named = (path: string, text: string) =>
  symbolsIn(path, text).map(
    ({ name, kind, from, to }) => `${kind} ${name} ${from}-${to}`,
  );

describe("what a file defines", () => {
  it("reads TypeScript and JavaScript", () => {
    const text = [
      "export const LIMIT = 4;",
      "export async function parse(source: string): Tree {",
      "  const inner = () => 1;",
      "  return tree;",
      "}",
      "",
      "export class Parser<T> extends Base {",
      "  private readonly depth = 0;",
      "  async next(token: Token): Promise<void> {",
      "    if (token) {",
      "      return;",
      "    }",
      "  }",
      "  describe('x', function () {",
      "  });",
      "}",
      "export interface Token {",
      "  kind: string;",
      "}",
      "export type Kind = 'a' | 'b';",
      "export const enum Mode { A, B }",
      "export const handle = async (event: Event) => {",
      "  run(event);",
      "};",
    ].join("\n");
    expect(named("src/parser.ts", text)).toEqual([
      "constant LIMIT 1-1",
      "function parse 2-5",
      "class Parser 7-16",
      "method next 9-13",
      "interface Token 17-19",
      "type Kind 20-20",
      "enum Mode 21-21",
      "function handle 22-24",
    ]);
  });

  it("reads Go", () => {
    const text = [
      "package merge",
      "",
      "const Limit = 3",
      "",
      "type Request struct {",
      "\tID int",
      "}",
      "",
      "type Merger interface {",
      "\tMerge() error",
      "}",
      "",
      "func (r *Request) Merge() error {",
      "\treturn nil",
      "}",
      "",
      "func New() *Request {",
      "\treturn &Request{}",
      "}",
    ].join("\n");
    expect(named("merge/merge.go", text)).toEqual([
      "constant Limit 3-3",
      "struct Request 5-7",
      "interface Merger 9-11",
      "method Merge 13-15",
      "function New 17-19",
    ]);
  });

  it("reads Rust", () => {
    const text = [
      "pub struct Index {",
      "    words: Vec<String>,",
      "}",
      "",
      "impl Index {",
      "    pub fn search(&self, word: &str) -> usize {",
      "        0",
      "    }",
      "}",
      "",
      "pub(crate) async fn build() {}",
      "pub trait Read {}",
      "pub enum Kind { A }",
      "const MOST: usize = 3;",
      "mod tests {",
      "}",
    ].join("\n");
    expect(named("src/index.rs", text)).toEqual([
      "struct Index 1-3",
      "method search 6-8",
      "function build 11-11",
      "trait Read 12-12",
      "enum Kind 13-13",
      "constant MOST 14-14",
      "module tests 15-16",
    ]);
  });

  it("reads Java", () => {
    const text = [
      "package org.example;",
      "",
      "public final class Approvals {",
      "    public static final int MOST = 3;",
      "",
      "    public List<String> approvers(Request request) {",
      "        return helper(request);",
      "    }",
      "}",
      "interface Rule {}",
      "enum Kind { A }",
    ].join("\n");
    expect(named("src/Approvals.java", text)).toEqual([
      "class Approvals 3-9",
      "constant MOST 4-4",
      "method approvers 6-8",
      "interface Rule 10-10",
      "enum Kind 11-11",
    ]);
  });

  it("reads Python", () => {
    const text = [
      "MOST_WORDS = 10",
      "",
      "class Index(Base):",
      "    def search(",
      "        self,",
      "        words,",
      "    ):",
      "        return []",
      "",
      "    async def build(self):",
      "        pass",
      "",
      "def main():",
      "    pass",
    ].join("\n");
    expect(named("index.py", text)).toEqual([
      "constant MOST_WORDS 1-1",
      "class Index 3-11",
      "method search 4-8",
      "method build 10-11",
      "function main 13-14",
    ]);
  });

  it("reads Ruby, through a rescue at the depth of the method", () => {
    const text = [
      "module MergeRequests",
      "  class MergeService < BaseService",
      "    LIMIT = 3",
      "",
      "    def execute(merge_request)",
      "      merge!",
      "    rescue StandardError",
      "      nil",
      "    end",
      "",
      "    def self.ready?",
      "      true",
      "    end",
      "  end",
      "end",
    ].join("\n");
    expect(named("app/services/merge_service.rb", text)).toEqual([
      "module MergeRequests 1-15",
      "class MergeService 2-14",
      "constant LIMIT 3-3",
      "method execute 5-9",
      "method ready? 11-13",
    ]);
  });

  it("reads C and C++", () => {
    const text = [
      "#define MOST 3",
      "struct node {",
      "  int value;",
      "};",
      "",
      "static int count_nodes(struct node *head)",
      "{",
      "  return 0;",
      "}",
      "",
      "namespace tree {",
      "class Walker : public Base {",
      "};",
      "void Walker::walk(int depth) {",
      "}",
      "}",
      "struct node *first(void);",
    ].join("\n");
    expect(named("src/tree.cc", text)).toEqual([
      "constant MOST 1-1",
      "struct node 2-4",
      "function count_nodes 6-9",
      "module tree 11-16",
      "class Walker 12-13",
      "function Walker::walk 14-15",
    ]);
  });

  it("reads a keyword as a name where a keyword introduced it", () => {
    const rust = [
      "impl Foo {",
      "    pub fn new() -> Self {",
      "        Foo { a: 0 }",
      "    }",
      "    fn other(&self) {}",
      "}",
    ].join("\n");
    expect(named("src/foo.rs", rust)).toEqual([
      "method new 2-4",
      "method other 5-5",
    ]);
    expect(
      named("lib/thing.py", "class A:\n    def delete(self):\n        pass\n"),
    ).toEqual(["class A 1-3", "method delete 2-3"]);
    expect(named("src/a.ts", "class A {\n  new(x) {\n  }\n}")).toEqual([
      "class A 1-4",
    ]);
  });

  it("ends a one-line definition on its own line", () => {
    const java = [
      "public class Limits {",
      "    private static final int MAX = 3;",
      "}",
    ].join("\n");
    expect(named("src/Limits.java", java)).toEqual([
      "class Limits 1-3",
      "constant MAX 2-2",
    ]);
    const ts = ["class Box {", "  get size() { return 1; }", "}"].join("\n");
    expect(named("src/box.ts", ts)).toEqual([
      "class Box 1-3",
      "method size 2-2",
    ]);
  });

  it("reads nothing from a file in a language it has no rules for", () => {
    expect(readsDefinitions("config/settings.yml")).toBe(false);
    expect(readsDefinitions("README")).toBe(false);
    expect(readsDefinitions("lib/thing.rb")).toBe(true);
    expect(symbolsIn("config/settings.yml", "def x\nend\n")).toEqual([]);
  });
});
