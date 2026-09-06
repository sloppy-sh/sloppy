import { RecordId } from "surrealdb";
import { describe, expect, it } from "vitest";
import { blockView } from "./api.js";
import { BlockSchema } from "./block.js";
import { emptyDocument } from "./document.js";

const AUTHOR = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva";
const BLOCK = "01JSPREAD00000000000000000";
const NOTE = "01JSPREAD00000000000000001";

describe("a stored block on the wire", () => {
  it("carries the section but not the words derived from it", () => {
    const row = BlockSchema.parse({
      id: new RecordId("block", { created_by: AUTHOR, id: BLOCK }),
      created_by: AUTHOR,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
      node: `${AUTHOR}/${NOTE}`,
      ord: "a0",
      content: emptyDocument(),
      text: "what the section says",
    });

    const view = blockView(row);

    expect(view.ref).toBe(`${AUTHOR}/${BLOCK}`);
    expect(view.node).toBe(`${AUTHOR}/${NOTE}`);
    expect(view.content).toEqual(row.content);
    expect(Object.keys(view)).not.toContain("text");
  });
});
