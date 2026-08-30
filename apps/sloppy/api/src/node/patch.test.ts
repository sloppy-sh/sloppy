import { describe, expect, it } from "vitest";
import { replacement } from "./patch";

interface Row {
  title?: string;
  tags?: string[];
  appearance?: { ring_weight?: string } | null;
}

describe("the SET clause a patch writes", () => {
  it("assigns every column the patch carries", () => {
    const set = replacement<Row>(["title", "tags"], {
      title: "A city remembers",
      tags: ["biology"],
    });
    expect(set.clause).toBe(
      "title = $changes.title, tags = $changes.tags, updated_at = $now",
    );
    expect(set.vars.changes).toEqual({
      title: "A city remembers",
      tags: ["biology"],
    });
  });

  it("leaves alone a column the patch does not carry", () => {
    const set = replacement<Row>(["title", "tags"], { tags: [] });
    expect(set.clause).toBe("tags = $changes.tags, updated_at = $now");
    expect(set.vars.changes).toEqual({ tags: [] });
  });

  // A column set to null and a column never written have to read back the same,
  // or a field taken off comes back as a value nothing can parse.
  it("clears a column the patch nulls rather than storing a null in it", () => {
    const set = replacement<Row>(["title", "appearance"], {
      title: "Kept",
      appearance: null,
    });
    expect(set.clause).toBe(
      "title = $changes.title, appearance = NONE, updated_at = $now",
    );
    expect(set.vars.changes).toEqual({ title: "Kept" });
  });

  it("stamps the time even when nothing else changed", () => {
    const set = replacement<Row>(["title", "tags"], {});
    expect(set.clause).toBe("updated_at = $now");
    expect(set.vars.now).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("names no column outside the ones it was handed", () => {
    const set = replacement<Row>(["title", "tags"], {
      title: "Kept",
      constructor: "smuggled past a schema",
    } as Row);
    expect(set.clause).toBe("title = $changes.title, updated_at = $now");
    expect(set.vars.changes).toEqual({ title: "Kept" });
  });
});
