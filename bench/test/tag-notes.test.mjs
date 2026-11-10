import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { loadRules } from "../anchor-docs.mjs";
import { coveredBy, notesByDocument, tagsFor } from "../tag-notes.mjs";
import { tempDir, write } from "./helpers.mjs";

function rules() {
  const root = tempDir("tag-notes-");
  const file = path.join(root, "rules.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      code_roots: ["engine/"],
      tag_rules: [
        { match: "^design/([^/]+)/", tags: ["$1"] },
        { match: "^design/[^/]+\\.md$", tags: ["design"] },
        { match: "^rfcs/", tags: ["rfc"] },
      ],
    }),
  );
  return loadRules(file);
}

describe("tag-notes", () => {
  it("reads the folders a Covers line names", () => {
    assert.deepEqual(
      coveredBy("# T\n\nCovers: engine/scan/, engine/fold_pass/\n"),
      ["engine/scan", "engine/fold_pass"],
    );
    assert.deepEqual(coveredBy("# T\n\nNo line here.\n"), []);
  });

  it("tags by path and by covered component, lower-cased and hyphenated, once each", () => {
    const held = rules();
    assert.deepEqual(
      tagsFor(
        "design/Name_Lookup/scopes.md",
        "Covers: engine/fold_pass/, vendor/zlib/\n",
        held,
      ),
      ["name-lookup", "fold-pass"],
    );
    assert.deepEqual(tagsFor("design/overview.md", "", held), ["design"]);
    assert.deepEqual(tagsFor("rfcs/r1.md", "Covers: engine/rfc/\n", held), [
      "rfc",
    ]);
    assert.deepEqual(tagsFor("README.md", "", held), []);
  });

  it("finds each carried document's note by the link its first block holds", () => {
    const root = tempDir("tag-notes-container-");
    const note = (id, first) =>
      write(
        root,
        `.sloppy/notes/${id}.md`,
        `---\nref: did:example:me/${id}\ntitle: T\n---\n\n<!-- block A -->\n\n${first}\n\n<!-- block B -->\n\n## Opening\n\n[other](code:design/b.md)\n`,
      );
    note("N1", "[design/a\\_b.md](code:design/a_b.md)");
    note("N2", "## Folder\n\nThe documents in `design`.");
    assert.deepEqual(
      [...notesByDocument(root)],
      [["design/a_b.md", "did:example:me/N1"]],
    );
  });
});
