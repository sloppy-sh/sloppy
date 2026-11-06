// `sloppy organise --agent`: the proposals handed to an agent that reads both
// notes of each, in a draft the person reviews whole and merges once —
// docs/ARCHITECTURE.md § "Tooling".

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Draft,
  finishDraft,
  OrganiseRefused,
  startDraft,
} from "./organise-draft.js";
import type { Proposals } from "./organise.js";

export const ORGANISING_AGENTS = ["claude-code"] as const;
export type OrganisingAgent = (typeof ORGANISING_AGENTS)[number];

/** The program each agent installs itself as. */
const AGENT_COMMANDS: Record<OrganisingAgent, string> = {
  "claude-code": "claude",
};

/** How this command is started again, as the notes' server for the agent. */
export interface SelfCommand {
  command: string;
  args: readonly string[];
}

/** The acts the agent may call. Everything else it is offered is refused. */
export const ORGANISING_ACTS = [
  "read_note",
  "read_around",
  "relate",
  "move_note",
  "link_notes",
  "style_edge",
] as const;

const SERVER = "sloppy";

/** Every tool of its own Claude Code could reach; none of them is allowed. */
const CLAUDE_BUILT_IN = [
  "Read",
  "Grep",
  "Glob",
  "Edit",
  "Write",
  "Bash",
  "NotebookEdit",
  "Task",
  "Agent",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
];

export const DEFAULT_BUDGET_USD = 1;

export interface OrganiseRun {
  project: string;
  proposals: Proposals;
  agent: OrganisingAgent;
  /** Where the agent's own program is; absent is wherever it installs itself. */
  command?: string;
  self: SelfCommand;
  model?: string;
  budgetUsd: number;
  on: Date;
}

export interface Organised {
  /** **Absent is a draft the agent wrote nothing in**, which is let go of. */
  branch?: string;
  /** What the agent said it did, in its own words. */
  said: string;
  /** What the agent's run cost, where it said. */
  costUsd?: number;
  /** Whether the agent stopped before it finished. */
  stopped: boolean;
}

export const NO_AGENT =
  "That agent is not installed here. Install it, or say which one to use with --agent.";

export function briefFor(proposals: Proposals): string {
  return [
    "You are tidying where the notes of this project hang and what joins them. You work in a draft: a person reads everything you change, whole, and decides whether to take it.",
    "",
    "Below is a list of proposals worked out from how related the notes are: the words they share, the code they point at, the notes both are linked with. They are guesses, not instructions.",
    "",
    "For each proposal:",
    "- Read both notes with read_note before deciding.",
    '- A move: carry the note with move_note, relation "under", only where it plainly springs out of the proposed note more than out of where it hangs now. Name no address: it takes the next one in its new run, and the one it leaves keeps leading to it.',
    "- A line: draw it with link_notes only where each note is about something the other explains, then label it with style_edge with what the line means, in a few words. The suggested label is a starting point, not the answer.",
    "- A note marked byPerson has a person's writing in it. Leave it where they put it unless the proposal is clearly better, and then say why.",
    "- Do nothing the list does not propose: no other moves, numbers, tags, writing or deleting.",
    "",
    "When you are done, answer with one line per proposal: what you did, or that you left it, and why.",
    "",
    "```json",
    JSON.stringify(proposals, null, 1),
    "```",
  ].join("\n");
}

/** The proposals judged by an agent in a fresh draft, and the draft kept as a
 *  branch where it wrote anything. */
export async function organiseWithAgent(run: OrganiseRun): Promise<Organised> {
  const draft = await startDraft(run.project, run.on);
  let answer: AgentAnswer;
  try {
    answer = await ranAgent(run, draft);
  } catch (thrown) {
    await finishDraft(draft, MESSAGE);
    throw thrown;
  }
  const branch = await finishDraft(draft, MESSAGE);
  return { ...(branch === undefined ? {} : { branch }), ...answer };
}

const MESSAGE = "Organise the notes: where they hang and what joins them";

interface AgentAnswer {
  said: string;
  costUsd?: number;
  stopped: boolean;
}

async function ranAgent(run: OrganiseRun, draft: Draft): Promise<AgentAnswer> {
  const aside = await mkdtemp(join(tmpdir(), "sloppy-organise-agent-"));
  try {
    const config = join(aside, "mcp.json");
    await writeFile(config, JSON.stringify(serverConfig(run.self, draft)));
    const out = await spawned(
      run.command ?? AGENT_COMMANDS[run.agent],
      claudeArgs(briefFor(run.proposals), config, run),
      draft.project,
    );
    return answerOf(out);
  } finally {
    await rm(aside, { recursive: true, force: true });
  }
}

function serverConfig(self: SelfCommand, draft: Draft): unknown {
  return {
    mcpServers: {
      [SERVER]: {
        type: "stdio",
        command: self.command,
        args: [
          ...self.args,
          "mcp",
          draft.project,
          "--profile",
          "lean",
          "--tools",
          "default",
        ],
      },
    },
  };
}

export function claudeArgs(
  prompt: string,
  config: string,
  run: Pick<OrganiseRun, "model" | "budgetUsd">,
): string[] {
  return [
    "-p",
    prompt,
    "--output-format",
    "json",
    "--tools",
    "",
    "--disallowedTools",
    CLAUDE_BUILT_IN.join(","),
    "--allowedTools",
    ORGANISING_ACTS.map((act) => `mcp__${SERVER}__${act}`).join(","),
    "--mcp-config",
    config,
    "--strict-mcp-config",
    "--permission-mode",
    "dontAsk",
    "--setting-sources",
    "project,local",
    "--no-session-persistence",
    "--disable-slash-commands",
    "--max-budget-usd",
    String(run.budgetUsd),
    ...(run.model === undefined ? [] : ["--model", run.model]),
  ];
}

function spawned(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<string> {
  return new Promise((done, failed) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      failed(error.code === "ENOENT" ? new OrganiseRefused(NO_AGENT) : error);
    });
    child.on("close", () => done(out));
  });
}

/** Claude Code's one JSON answer, read from the last line that is one. */
function answerOf(out: string): AgentAnswer {
  for (const line of out.trim().split("\n").reverse()) {
    let held: unknown;
    try {
      held = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof held !== "object" || held === null) continue;
    const result = held as {
      type?: string;
      is_error?: boolean;
      result?: unknown;
      total_cost_usd?: unknown;
    };
    if (result.type !== "result") continue;
    return {
      said: typeof result.result === "string" ? result.result : "",
      ...(typeof result.total_cost_usd === "number"
        ? { costUsd: result.total_cost_usd }
        : {}),
      stopped: result.is_error === true,
    };
  }
  return { said: "", stopped: true };
}
