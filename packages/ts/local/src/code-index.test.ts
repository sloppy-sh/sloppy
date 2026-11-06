// Where something is in a project's code, ranked against some words.

import { describe, expect, it } from "vitest";
import {
  type CodeFile,
  codeFound,
  codeIndexOf,
  identifierWords,
  placeOf,
} from "./code-index.js";
import { symbolsIn } from "./code-symbols.js";

function file(path: string, text: string): CodeFile {
  return { path, symbols: symbolsIn(path, text) };
}

const PROJECT = codeIndexOf([
  file(
    "app/services/merge_requests/approval_service.rb",
    "class ApprovalService\n  def execute(request)\n    approve!\n  end\n\n  def approvers_left\n    []\n  end\nend\n",
  ),
  file(
    "app/models/merge_request.rb",
    "class MergeRequest\n  def mergeable?\n    true\n  end\nend\n",
  ),
  file(
    "spec/services/merge_requests/approval_service_spec.rb",
    "def approval_helper\nend\n",
  ),
  file(
    "src/parser.ts",
    "export function parseSource(text: string) {\n  return text;\n}\nexport const parse = 1;\n",
  ),
  file("src/emit.ts", "export function emit() {\n}\n"),
  file("config/approvals.yml", ""),
]);

const places = (words: string, limit = 5) =>
  codeFound(PROJECT, words, limit).map(placeOf);

describe("the words an identifier is made of", () => {
  it("splits at case, underscores, separators and digits, keeping a name written in several cases whole", () => {
    expect(identifierWords("parseHTTPRequest2")).toEqual([
      "parse",
      "http",
      "request",
      "2",
      "parsehttprequest2",
    ]);
    expect(identifierWords("app/merge_requests/x.rb")).toEqual([
      "app",
      "merge",
      "request",
      "x",
      "rb",
    ]);
  });
});

describe("finding where something is in the code", () => {
  it("answers a name spelled exactly first, whatever else the words reach", () => {
    expect(places("where is parseSource defined")[0]).toBe(
      "src/parser.ts#L1-L3",
    );
    expect(places("mergeable?")[0]).toBe("app/models/merge_request.rb#L2-L4");
  });

  it("ranks by the words a definition's name and path carry", () => {
    const found = codeFound(PROJECT, "approval service execute", 3);
    expect(found[0]).toMatchObject({
      path: "app/services/merge_requests/approval_service.rb",
      name: "execute",
      kind: "method",
    });
  });

  it("puts the tests behind the code they test unless the words ask for them", () => {
    const paths = codeFound(PROJECT, "approval", 10).map((hit) => hit.path);
    expect(
      paths.indexOf("app/services/merge_requests/approval_service.rb"),
    ).toBeLessThan(
      paths.indexOf("spec/services/merge_requests/approval_service_spec.rb"),
    );
    expect(codeFound(PROJECT, "approval spec", 1)[0]?.path).toBe(
      "spec/services/merge_requests/approval_service_spec.rb",
    );
  });

  it("names a file by its path where nothing in it is defined", () => {
    expect(codeFound(PROJECT, "approvals config", 1)[0]).toEqual({
      path: "config/approvals.yml",
      kind: "file",
    });
  });

  it("names no file more than twice, and a file once its definitions are named", () => {
    const found = codeFound(PROJECT, "approval service approvers execute", 10);
    const service = found.filter(
      (hit) => hit.path === "app/services/merge_requests/approval_service.rb",
    );
    expect(service.length).toBe(2);
    expect(service.every((hit) => hit.kind !== "file")).toBe(true);
  });

  it("reads an ordinary word in a sentence as a word, not as a name", () => {
    const index = codeIndexOf([
      file("lib/merge.rb", "def merge\nend\n"),
      file(
        "app/services/merge_request_approvals.rb",
        "class MergeRequestApprovals\nend\n",
      ),
    ]);
    expect(codeFound(index, "merge request approvals", 1)[0]?.name).toBe(
      "MergeRequestApprovals",
    );
    expect(codeFound(index, "merge", 1)[0]?.name).toBe("merge");
  });

  it("points at no one place by a name defined in many of them", () => {
    const wrapped = Array.from({ length: 30 }, (_, at) =>
      file(`lib/api/thing_${at}.rb`, "module API\nend\n"),
    );
    const index = codeIndexOf([
      ...wrapped,
      file("lib/api/rate_limiter.rb", "module RateLimiter\nend\n"),
    ]);
    expect(codeFound(index, "API rate limiter", 1)[0]?.name).toBe(
      "RateLimiter",
    );
  });

  it("answers nothing where no word reaches anything", () => {
    expect(codeFound(PROJECT, "the of where", 5)).toEqual([]);
    expect(codeFound(PROJECT, "zebra", 5)).toEqual([]);
  });

  it("answers the same words the same way", () => {
    expect(places("merge request", 10)).toEqual(places("merge request", 10));
  });
});
