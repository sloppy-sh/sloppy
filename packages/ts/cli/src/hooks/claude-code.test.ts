import { charsOver4, MemoryFiles } from "@sloppy/local";
import { encodeText, graphFile, type VaultGraph } from "@sloppy/vault";
import { describe, expect, it } from "vitest";
import { FINE, NOTHING_DONE, run } from "../run.js";

const DID = "did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE";
const A = "01J0000000000000000000000A";
const BLOCK = "01J000000000000000000000B1";

const GRAPH: VaultGraph = {
  format: 1,
  graph: "01J000000000000000000000GR",
  name: "An orchard",
  owner: DID,
  project: "..",
};

const QUINCE = "Quince stock keeps the apple tree small.";

async function orchard(body: string): Promise<MemoryFiles> {
  const root = new MemoryFiles({ root: "/" });
  const container = root.at("/orchard/.sloppy");
  await container.write("graph.json", graphFile(GRAPH));
  await container.write(
    `notes/${A}.md`,
    encodeText(
      [
        "---",
        `ref: ${DID}/${A}`,
        "title: The rootstock",
        "---",
        "",
        `<!-- block ${BLOCK} -->`,
        "",
        body,
        "",
      ].join("\n"),
    ),
  );
  return root;
}

interface Hooked {
  code: number;
  out: string[];
  err: string[];
}

async function hook(
  argv: string[],
  files: MemoryFiles,
  sent: object = {},
): Promise<Hooked> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(["hook", ...argv], {
    cwd: "/elsewhere",
    told: { out: (line) => out.push(line), err: (line) => err.push(line) },
    filesAt: (root) => files.at(root),
    calls: [JSON.stringify(sent)],
  });
  return { code, out, err };
}

function added(out: readonly string[]): string {
  expect(out).toHaveLength(1);
  const { hookSpecificOutput } = JSON.parse(out[0]);
  expect(hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
  return hookSpecificOutput.additionalContext;
}

const PROMPT = {
  hook_event_name: "UserPromptSubmit",
  prompt: "why is quince the stock?",
  cwd: "/orchard/src",
};

describe("sloppy hook prompt", () => {
  it("puts what the notes say about a prompt in front of the model", async () => {
    const { code, out } = await hook(
      ["prompt"],
      await orchard(`${QUINCE}\n\nIt stays under two metres.`),
      PROMPT,
    );
    expect(code).toBe(FINE);
    const context = added(out);
    expect(context).toContain("The rootstock");
    expect(context).toContain(QUINCE);
  });

  it("adds nothing for a prompt the notes only brush against", async () => {
    const files = await orchard(`${QUINCE}\n\nIt stays under two metres.`);
    for (const prompt of ["yes", "ok go ahead", "keep the tests small"]) {
      const { code, out } = await hook(["prompt"], files, {
        ...PROMPT,
        prompt,
      });
      expect(code).toBe(FINE);
      expect(out).toEqual([]);
    }
  });

  it("answers a prompt naming a note's title in one word", async () => {
    const { out } = await hook(["prompt"], await orchard(QUINCE), {
      ...PROMPT,
      prompt: "rootstock?",
    });
    expect(added(out)).toContain("The rootstock");
  });

  it("adds nothing in a folder with no notes", async () => {
    const { code, out, err } = await hook(["prompt"], await orchard(QUINCE), {
      ...PROMPT,
      cwd: "/somewhere/else",
    });
    expect(code).toBe(FINE);
    expect(out).toEqual([]);
    expect(err).toEqual([]);
  });

  it("adds nothing for what is not a prompt", async () => {
    const files = await orchard(QUINCE);
    for (const sent of [{ cwd: "/orchard" }, { ...PROMPT, prompt: "  " }]) {
      const { code, out } = await hook(["prompt"], files, sent);
      expect(code).toBe(FINE);
      expect(out).toEqual([]);
    }
  });

  it("keeps what it adds within the budget it was given", async () => {
    const files = await orchard(
      Array.from({ length: 40 }, (_, at) => `${QUINCE} Row ${at}.`).join(
        "\n\n",
      ),
    );
    const whole = added((await hook(["prompt"], files, PROMPT)).out);
    const budget = Math.floor(charsOver4(whole) / 3);

    const { out } = await hook(
      ["prompt", "--window", String(budget)],
      files,
      PROMPT,
    );
    const cut = added(out);
    expect(charsOver4(cut)).toBeLessThanOrEqual(budget);
    expect(cut).toContain("The rootstock");
  });
});

describe("sloppy hook", () => {
  it("says what to add to Claude Code's settings, and what it does", async () => {
    const { code, out } = await hook(["--window", "4000"], new MemoryFiles());
    expect(code).toBe(FINE);
    const said = out.join("\n");
    expect(said).toContain("each prompt you give Claude Code");
    const settings = JSON.parse(said.slice(said.indexOf("{")));
    expect(settings.hooks.UserPromptSubmit[0].hooks[0]).toEqual({
      type: "command",
      command: "sloppy hook prompt --window 4000",
    });
  });

  it("refuses a window that is not a count", async () => {
    const { code, err } = await hook(["--window", "lots"], new MemoryFiles());
    expect(code).toBe(NOTHING_DONE);
    expect(err).toEqual([
      "Say how much of the notes to put in front of it: --window 16000.",
    ]);
  });
});
