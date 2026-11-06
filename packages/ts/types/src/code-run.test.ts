// Which lines of a file an anchor into code stands for.

import { describe, expect, it } from "vitest";
import { parseCodeAnchor } from "./code-anchor.js";
import { codePlace, RUN_LINES } from "./code-run.js";

const FILE = Array.from({ length: 100 }, (_, at) =>
  at === 49 ? "export function discover() {" : `const line${at + 1} = 1;`,
).join("\n");

function placed(href: string, text = FILE): string | undefined {
  const anchor = parseCodeAnchor(href);
  if (!anchor) throw new Error(`Not an anchor: ${href}`);
  return codePlace(anchor, text);
}

describe("the lines an anchor stands for", () => {
  it("are every line of a file named whole", () => {
    expect(placed("code:src/a.ts")).toBe("src/a.ts#L1-L100");
    expect(placed("code:src/a.ts", "one\ntwo\n")).toBe("src/a.ts#L1-L2");
  });

  it("are the run named, stopped at the end of the file", () => {
    expect(placed("code:src/a.ts#L5-L9")).toBe("src/a.ts#L5-L9");
    expect(placed("code:src/a.ts#L7")).toBe("src/a.ts#L7-L7");
    expect(placed("code:src/a.ts#L95-L140")).toBe("src/a.ts#L95-L100");
  });

  it("are the stretch a name opens, from just above the line it is on, as the code sheet shows it", () => {
    expect(placed("code:src/a.ts#discover")).toBe(
      `src/a.ts#L48-L${48 + RUN_LINES - 1}`,
    );
  });

  it("are none for a name the file no longer holds", () => {
    expect(placed("code:src/a.ts#vanished")).toBeUndefined();
  });
});
