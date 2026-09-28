import { CODE_DIGEST_ALGORITHM, type CodeReading } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import { type CodeNow, digestOf, driftOf, readingsNow } from "./drift.js";
import { encodeText } from "./layout.js";

/** A project holding these files, as the drift reader asks about one. */
function project(files: Record<string, string>): CodeNow {
  return async (path) => {
    const said = files[path];
    return said === undefined ? undefined : digestOf(encodeText(said));
  };
}

async function readAgainst(
  files: Record<string, string>,
): Promise<CodeReading[]> {
  return readingsNow(Object.keys(files), project(files));
}

describe("a digest of a file", () => {
  it("is the algorithm that produced it and lowercase hex", async () => {
    expect(await digestOf(encodeText("a"))).toBe(
      `${CODE_DIGEST_ALGORITHM}:ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb`,
    );
  });

  it("is the same for the same bytes and different for different ones", async () => {
    expect(await digestOf(encodeText("one"))).toBe(
      await digestOf(encodeText("one")),
    );
    expect(await digestOf(encodeText("one"))).not.toBe(
      await digestOf(encodeText("two")),
    );
  });
});

describe("what the code has done under a note", () => {
  it("says nothing has moved where every file stands as it was read", async () => {
    const files = { "src/a.ts": "one", "src/b.ts": "two" };
    expect(
      await driftOf(
        ["src/a.ts", "src/b.ts"],
        await readAgainst(files),
        project(files),
      ),
    ).toEqual({ drifted: [], unread: [] });
  });

  it("names the file that has changed since, and only it", async () => {
    const readings = await readAgainst({
      "src/a.ts": "one",
      "src/b.ts": "two",
    });
    const now = project({ "src/a.ts": "one", "src/b.ts": "two, rewritten" });
    expect(await driftOf(["src/a.ts", "src/b.ts"], readings, now)).toEqual({
      drifted: ["src/b.ts"],
      unread: [],
    });
  });

  it("names a file the project has not got any more", async () => {
    const readings = await readAgainst({ "src/a.ts": "one" });
    expect(await driftOf(["src/a.ts"], readings, project({}))).toEqual({
      drifted: ["src/a.ts"],
      unread: [],
    });
  });

  it("holds a path nobody read the note against as unread, however far it has moved", async () => {
    const readings = await readAgainst({ "src/a.ts": "one" });
    const now = project({ "src/a.ts": "one", "src/b.ts": "written since" });
    expect(await driftOf(["src/a.ts", "src/b.ts"], readings, now)).toEqual({
      drifted: [],
      unread: ["src/b.ts"],
    });
  });

  it("holds a note read against nothing as unread and never as out of date", async () => {
    const now = project({ "src/a.ts": "one" });
    expect(await driftOf(["src/a.ts"], undefined, now)).toEqual({
      drifted: [],
      unread: ["src/a.ts"],
    });
    expect(await driftOf(["src/a.ts"], [], now)).toEqual({
      drifted: [],
      unread: ["src/a.ts"],
    });
  });

  it("holds a reading it cannot reproduce as unread rather than crying wolf", async () => {
    const readings = [{ path: "src/a.ts", digest: `blake3:${"c".repeat(64)}` }];
    expect(
      await driftOf(["src/a.ts"], readings, project({ "src/a.ts": "one" })),
    ).toEqual({ drifted: [], unread: ["src/a.ts"] });
  });

  it("passes over a reading of a path the note no longer points at", async () => {
    const readings = await readAgainst({
      "src/a.ts": "one",
      "src/gone.ts": "two",
    });
    expect(
      await driftOf(["src/a.ts"], readings, project({ "src/a.ts": "one" })),
    ).toEqual({ drifted: [], unread: [] });
  });

  it("answers nothing for a note pointing at no code at all", async () => {
    expect(await driftOf([], undefined, project({}))).toEqual({
      drifted: [],
      unread: [],
    });
  });

  it("reads each file once however often a note points at it", async () => {
    let asked = 0;
    const now: CodeNow = async (path) => {
      asked++;
      return digestOf(encodeText(path));
    };
    await driftOf(
      ["src/a.ts", "src/a.ts"],
      await readingsNow(["src/a.ts"], now),
      now,
    );
    expect(asked).toBe(2);
  });
});

describe("the readings a note takes when somebody says it still holds", () => {
  it("is one per place it points at, in path order", async () => {
    const now = project({ "src/b.ts": "two", "src/a.ts": "one" });
    const readings = await readingsNow(["src/b.ts", "src/a.ts"], now);
    expect(readings.map((one) => one.path)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("names no file the project has not got", async () => {
    const readings = await readingsNow(
      ["src/a.ts", "src/gone.ts"],
      project({ "src/a.ts": "one" }),
    );
    expect(readings.map((one) => one.path)).toEqual(["src/a.ts"]);
  });

  it("settles what it wrote: nothing has drifted straight afterwards", async () => {
    const files = { "src/a.ts": "one", "src/b.ts": "two" };
    const paths = Object.keys(files);
    const readings = await readingsNow(paths, project(files));
    expect(await driftOf(paths, readings, project(files))).toEqual({
      drifted: [],
      unread: [],
    });
  });
});
