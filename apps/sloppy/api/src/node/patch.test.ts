import { describe, expect, it } from "vitest";
import { replacement } from "./patch";

interface Row {
  title?: string;
  labels?: Record<string, string>;
}

describe("the SET clause a patch writes", () => {
  it("assigns every column the patch carries", () => {
    const set = replacement<Row>(["title", "labels"], {
      title: "A city remembers",
      labels: { domain: "biology" },
    });
    expect(set.clause).toBe(
      "title = $changes.title, labels = $changes.labels, updated_at = $now",
    );
    expect(set.vars.changes).toEqual({
      title: "A city remembers",
      labels: { domain: "biology" },
    });
  });

  it("leaves alone a column the patch does not carry", () => {
    const set = replacement<Row>(["title", "labels"], { labels: {} });
    expect(set.clause).toBe("labels = $changes.labels, updated_at = $now");
    expect(set.vars.changes).toEqual({ labels: {} });
  });

  it("stamps the time even when nothing else changed", () => {
    const set = replacement<Row>(["title", "labels"], {});
    expect(set.clause).toBe("updated_at = $now");
    expect(set.vars.now).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("names no column outside the ones it was handed", () => {
    const set = replacement<Row>(["title", "labels"], {
      title: "Kept",
      constructor: "smuggled past a schema",
    } as Row);
    expect(set.clause).toBe("title = $changes.title, updated_at = $now");
    expect(set.vars.changes).toEqual({ title: "Kept" });
  });
});
