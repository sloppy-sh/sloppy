import { describe, expect, it } from "vitest";
import { STATEMENTS, USER_PURGE_TABLES } from "./purge.js";
import { SCHEMA, SLOPPY_TABLES } from "./schema.js";

describe("the tables the schema declares", () => {
  it("are all of them", () => {
    // SLOPPY_TABLES is read out of SCHEMA, and a pattern that stopped matching
    // would empty it silently — taking the purge coverage test below with it.
    expect(SLOPPY_TABLES).toHaveLength(
      (SCHEMA.match(/DEFINE TABLE/g) ?? []).length,
    );
    expect(SLOPPY_TABLES.length).toBeGreaterThan(0);
  });
});

describe("the per-user purge", () => {
  it("sweeps every table the schema defines", () => {
    // A table declared and then forgotten here fails nowhere else: it just
    // keeps somebody's rows after they asked to be gone.
    for (const table of SLOPPY_TABLES) {
      expect(USER_PURGE_TABLES.has(table)).toBe(true);
    }
  });

  it("names no table the schema does not define", () => {
    for (const table of USER_PURGE_TABLES) {
      expect(SLOPPY_TABLES).toContain(table);
    }
  });

  it("deletes by the owner column, never through a parent row", () => {
    for (const statement of STATEMENTS) {
      expect(statement).toMatch(
        /^DELETE \w+ WHERE (?:created_by|by) = \$did;$/,
      );
    }
  });

  it("reaches the offers this person left on other people's notes", () => {
    // The one row a purge cannot find by the owner of the rows: it stands in
    // somebody else's graph, and leaving it there leaves this person's writing
    // on a note after the identity behind it is gone.
    expect(STATEMENTS).toContain("DELETE amendment WHERE by = $did;");
    const byOwner = STATEMENTS.filter((statement) =>
      statement.includes("WHERE by = $did"),
    );
    expect(byOwner).toHaveLength(1);
  });

  it("has a statement for every table it claims to sweep", () => {
    const swept = STATEMENTS.map(
      (statement) => statement.match(/^DELETE (\w+)/)?.[1],
    );
    expect(new Set(swept)).toEqual(USER_PURGE_TABLES);
  });
});
