// What `sloppy <command>` does — docs/ARCHITECTURE.md § "Tooling". One
// dispatcher, given where it is and somewhere to write, so the same run is
// exercised by a test and by the bin beside this file.

import { basename, dirname, relative, resolve } from "node:path";
import { SloppyApiError } from "@sloppy/client";
import {
  type CodeReader,
  CONTAINER_DIR,
  containerDataAt,
  containerOf,
  type Files,
  LocalApi,
  type NoteHere,
  notesHere,
  placeApi,
} from "@sloppy/local";
import {
  ANSWER_SHAPES,
  CHAT_TOOLS,
  type ChatToolName,
  DEFAULT_SERVING,
  DOCTRINES,
  LEAN_SERVING,
  type OwnedRef,
  type Serving,
  type Tag,
  TagSchema,
  TOOL_SETS,
} from "@sloppy/types";
import { NOTES_DIR, VaultFormatError } from "@sloppy/vault";
import { check } from "./check.js";
import { codeReader } from "./code-reader.js";
import { containerAt, heldAt } from "./folder.js";
import { draft } from "./draft.js";
import { init, InitRefused } from "./init.js";
import { NO_NOTES_HERE, ownVersion, serveMcp } from "./mcp.js";
import { NodeFiles } from "./node-files.js";
import {
  DEFAULT_BUDGET_USD,
  ORGANISING_AGENTS,
  type OrganisingAgent,
  organiseWithAgent,
  type SelfCommand,
} from "./organise-agent.js";
import { keptIn, OrganiseRefused } from "./organise-draft.js";
import { reviewLines, reviewOf } from "./organise-review.js";
import { type NoteNamed, type Proposals, proposalsFor } from "./organise.js";
import { git } from "./git.js";
import type { WriteDone } from "./writer.js";

export const COMMANDS = ["init", "draft", "check", "organise", "mcp"] as const;
export type Command = (typeof COMMANDS)[number];

/** Nothing to fix. */
export const FINE = 0;
/** Something to fix, listed. */
export const TO_FIX = 1;
/** Nothing done: a command that is not here yet, or one nobody has. */
export const NOTHING_DONE = 2;

/** The options that take the word after them as their value. */
const VALUED = new Set([
  "identity",
  "tag",
  "doctrine",
  "tools",
  "answers",
  "profile",
  "notes",
  "since",
  "agent",
  "review",
  "model",
  "budget",
  "without",
]);

export interface Told {
  out(line: string): void;
  err(line: string): void;
}

export interface CliContext {
  /** The folder the command was run in. */
  cwd: string;
  told: Told;
  /** Where a folder is reached, and where what is nobody else's business goes
   *  for it; absent is this disk. */
  filesAt?: (root: string, data: string) => Files;
  /** The lines `mcp` is sent, one message each; absent is nothing sent. Its
   *  answers go to `told.out`, a line each. */
  calls?: AsyncIterable<string> | Iterable<string>;
  /** How this command is started again; absent is `sloppy` wherever it is
   *  installed. */
  self?: SelfCommand;
  /** Where each agent `organise --agent` names is; absent is wherever it
   *  installs itself. */
  agentAt?: Partial<Record<OrganisingAgent, string>>;
}

/** `--name` is `true`, `--name=value` and `--name value` are the value. */
export interface Asked {
  command?: string;
  paths: string[];
  options: Map<string, string | true>;
}

export function parse(argv: readonly string[]): Asked {
  const paths: string[] = [];
  const options = new Map<string, string | true>();
  for (let at = 0; at < argv.length; at++) {
    const held = argv[at];
    if (!held.startsWith("-")) {
      paths.push(held);
      continue;
    }
    const name = held.replace(/^--?/, "");
    const equals = name.indexOf("=");
    if (equals !== -1) {
      options.set(name.slice(0, equals), name.slice(equals + 1));
      continue;
    }
    const next = argv[at + 1];
    if (VALUED.has(name) && next !== undefined && !next.startsWith("-")) {
      options.set(name, next);
      at++;
      continue;
    }
    options.set(name, true);
  }
  return {
    ...(paths.length > 0 ? { command: paths[0] } : {}),
    paths: paths.slice(1),
    options,
  };
}

const USAGE = [
  "sloppy — the notes that live with the code.",
  "",
  "  sloppy init [dir]      start the notes in a project, and write what the tree can tell",
  "  sloppy draft [paths…]  a note in detail per file named, never over somebody's writing",
  "  sloppy check [dir]     read every note and say what doesn't hold",
  "  sloppy organise [dir]  propose where notes would hang better and what would join them",
  "  sloppy mcp [dir]       serve these notes to an assistant, under the rules the app keeps",
  "",
  "  --identity <file>      write as the identity in that file, rather than one made here",
  "  --tag <a,b>            tag every note it writes, alongside what each already carries",
  "  --json                 answer in JSON instead of lines",
  "  --doctrine <which>     for mcp: answer-first (the default), or notes-first to have the",
  "                         assistant look in the notes before anything else",
  "  --tools <which>        for mcp: default, every act, or core, the ones ordinary work needs",
  "                         in short words",
  "  --answers <which>      for mcp: default, or terse for the same facts in fewer words",
  "  --land-on-code         for mcp: name the exact lines of code each note points at",
  "  --profile <which>      for mcp: lean, the default, is --tools core --answers terse --land-on-code;",
  "                         full is every act, answered as the app's chat reads it",
  "  --notes <refs>         for organise: only these notes",
  "  --since <commit>       for organise: only the notes changed since that version",
  "  --loose                for organise: only notes hung straight under a branch's first note,",
  "                         or under one they relate to little",
  "  --agent <which>        for organise: claude-code, to judge the proposals in a draft branch",
  "  --model, --budget      for organise --agent: which model, and the most to spend in dollars",
  "  --review <branch>      for organise: what a draft branch changed, note by note",
  "  --without <a,b>        for mcp: leave those acts out, neither offered nor answered",
  "  --help                 this",
];

export async function run(
  argv: readonly string[],
  context: CliContext,
): Promise<number> {
  const asked = parse(argv);
  const { told } = context;
  // `mcp`'s output is its caller's protocol, so a line for a person goes
  // anywhere else.
  const serves = asked.command === "mcp";
  const usage = (line: string) => (serves ? told.err(line) : told.out(line));
  if (asked.options.has("help") || asked.options.has("h") || !asked.command) {
    for (const line of USAGE) usage(line);
    return asked.command ? FINE : NOTHING_DONE;
  }
  const command = COMMANDS.find((held) => held === asked.command);
  if (!command) {
    told.err(`No such command: ${asked.command}`);
    for (const line of USAGE) usage(line);
    return NOTHING_DONE;
  }
  const json = asked.options.has("json") && !serves;
  try {
    switch (command) {
      case "check":
        return await checking(asked, context, json);
      case "init":
        return await starting(asked, context, json);
      case "draft":
        return await drafting(asked, context, json);
      case "organise":
        return await organising(asked, context, json);
      case "mcp":
        return await serving(asked, context);
    }
  } catch (thrown) {
    return nothingDone(command, told, json, whyStopped(thrown));
  }
}

/** A run that stopped, in words a person can act on. A refusal and a folder
 *  this build cannot read both say what they are already; anything else is
 *  this machine's own trouble, and its words are not for anybody. */
function whyStopped(thrown: unknown): string {
  if (thrown instanceof VaultFormatError || thrown instanceof InitRefused) {
    return thrown.message;
  }
  if (thrown instanceof SloppyApiError) return thrown.message;
  if (thrown instanceof OrganiseRefused) return thrown.message;
  return "That didn't work. Check the folder is there and is yours, and try again.";
}

function said(command: Command, line: string): string {
  return JSON.stringify({ command, said: line });
}

/** A run with nothing read and so nothing listed, in whichever answer was asked
 *  for. */
function nothingDone(
  command: Command,
  told: Told,
  json: boolean,
  line: string,
): number {
  if (json) told.out(said(command, line));
  else told.err(line);
  return NOTHING_DONE;
}

function filesFor(context: CliContext, root: string): Files {
  return (context.filesAt ?? ((at, data) => new NodeFiles({ root: at, data })))(
    root,
    containerDataAt(root),
  );
}

/** The folder named, from wherever the command was run. */
function folderNamed(context: CliContext, named?: string): string {
  return resolve(context.cwd, named ?? ".");
}

/** The project whose notes a command works on: the nearest folder at or above
 *  this one holding a container. A folder that is itself a graph is that
 *  graph, and has no code beside it. */
async function projectAbove(
  context: CliContext,
  from: string,
): Promise<{ root: string; files: Files } | undefined> {
  let at = from;
  for (;;) {
    const files = filesFor(context, at);
    if ((await containerOf(files)) !== undefined) return { root: at, files };
    const up = dirname(at);
    if (up === at) return undefined;
    at = up;
  }
}

const NO_NOTES = "There are no notes in that folder yet.";

/** What `draft` says it did with each file it was named. */
const DRAFTED: Record<WriteDone, string> = {
  written: "written.",
  offered: "offered; it shows once the note's author takes it in.",
};

async function checking(
  asked: Asked,
  context: CliContext,
  json: boolean,
): Promise<number> {
  const at = folderNamed(context, asked.paths[0]);
  const files = filesFor(context, at);
  const container = await containerAt(files);
  if (!container) return nothingDone("check", context.told, json, NO_NOTES);
  const result = await check(container, codeReader());
  if (json) {
    context.told.out(JSON.stringify({ command: "check", ...result }));
    return result.defects.length === 0 ? FINE : TO_FIX;
  }
  for (const defect of result.defects) {
    context.told.out(`${defect.file}: ${defect.said}`);
  }
  if (result.defects.length === 0) {
    const notes = result.notes === 1 ? "1 note" : `${result.notes} notes`;
    context.told.out(`${notes} read. Nothing to fix.`);
    return FINE;
  }
  return TO_FIX;
}

async function starting(
  asked: Asked,
  context: CliContext,
  json: boolean,
): Promise<number> {
  const at = folderNamed(context, asked.paths[0]);
  const files = filesFor(context, at);
  const named = asked.options.get("identity");
  if (named === true) {
    return nothingDone(
      "init",
      context.told,
      json,
      "Name the file your identity is in.",
    );
  }
  let identity: Uint8Array | undefined;
  if (named !== undefined) {
    const file = resolve(context.cwd, named);
    identity = await filesFor(context, dirname(file)).read(basename(file));
    if (!identity) {
      return nothingDone("init", context.told, json, "That file isn't there.");
    }
  }
  const done = await init({
    files,
    root: at,
    ...(identity === undefined ? {} : { identity }),
  });
  if (json) {
    context.told.out(JSON.stringify({ command: "init", ...done }));
    return FINE;
  }
  if (done.started) context.told.out("Notes started in this project.");
  if (done.notes.length === 0) {
    context.told.out(
      done.started
        ? "Nothing here to write about yet."
        : "Everything here already has a note.",
    );
    return FINE;
  }
  context.told.out(
    done.notes.length === 1
      ? "Wrote a note about:"
      : "Wrote a note about each:",
  );
  for (const note of done.notes) context.told.out(`  ${note.title}`);
  return FINE;
}

async function drafting(
  asked: Asked,
  context: CliContext,
  json: boolean,
): Promise<number> {
  if (asked.paths.length === 0) {
    return nothingDone(
      "draft",
      context.told,
      json,
      "Name the files to write about.",
    );
  }
  const found = await projectAbove(context, folderNamed(context));
  if (!found) return nothingDone("draft", context.told, json, NO_NOTES);
  const container = await containerAt(found.files);
  if (!container) return nothingDone("draft", context.told, json, NO_NOTES);
  const held = await heldAt(container);
  if (!held.project) {
    return nothingDone(
      "draft",
      context.told,
      json,
      "These notes are not about any code.",
    );
  }
  const project = held.project;
  const inside: string[] = [];
  const outside: { path: string; said: string }[] = [];
  for (const named of asked.paths) {
    const path = relative(project.root, resolve(context.cwd, named));
    if (path === "" || path.startsWith("..")) {
      outside.push({ path: named, said: "That isn't a file in this project." });
      continue;
    }
    inside.push(path.split("\\").join("/"));
  }
  const tags = tagsAsked(asked);
  if (typeof tags === "string") {
    return nothingDone("draft", context.told, json, tags);
  }
  const done = await draft({
    container,
    project,
    api: new LocalApi(found.files),
    paths: inside,
    tags,
  });
  const missed = [...outside, ...done.missed];
  if (json) {
    context.told.out(
      JSON.stringify({ command: "draft", notes: done.notes, missed }),
    );
    return missed.length === 0 ? FINE : TO_FIX;
  }
  for (const note of done.notes) {
    context.told.out(`${note.path}: ${DRAFTED[note.done]}`);
  }
  for (const one of missed) context.told.out(`${one.path}: ${one.said}`);
  return missed.length === 0 ? FINE : TO_FIX;
}

/** Serves until the caller is done. A folder with no notes is still served,
 *  and every call it is sent is answered with how to start them. */
async function serving(asked: Asked, context: CliContext): Promise<number> {
  const serving = servingAsked(asked);
  if (typeof serving === "string") {
    context.told.err(serving);
    return NOTHING_DONE;
  }
  const found = await projectAbove(
    context,
    folderNamed(context, asked.paths[0]),
  );
  if (!found) context.told.err(NO_NOTES_HERE);
  const code = codeReader();
  if (found) void warmed(found.files, code);
  await serveMcp({
    ...(found === undefined ? {} : { files: found.files }),
    code,
    calls: context.calls ?? [],
    answer: (line) => context.told.out(line),
    version: await ownVersion(),
    ...serving,
  });
  return FINE;
}

/** Starts reading the project's code as the server starts, so the first
 *  `find_code` finds it read. */
async function warmed(files: Files, code: CodeReader): Promise<void> {
  try {
    const container = await containerAt(files);
    const project = container && (await heldAt(container)).project;
    if (project) await code(project.root);
  } catch {
    // The call that asks for it says what went wrong.
  }
}

const PROFILES = ["lean", "full"] as const;

/** How `mcp` was asked to serve: `--profile` first, then each flag over it.
 *  The words to say where one names something there is none of. */
function servingAsked(
  asked: Asked,
): (Serving & { without: ChatToolName[] }) | string {
  const profile = oneOf(asked, "profile", PROFILES, "lean");
  if (profile === undefined) return sayWhich("profile", PROFILES);
  const from = profile === "full" ? DEFAULT_SERVING : LEAN_SERVING;
  const doctrine = oneOf(asked, "doctrine", DOCTRINES, from.doctrine);
  if (doctrine === undefined) return sayWhich("doctrine", DOCTRINES);
  const tools = oneOf(asked, "tools", TOOL_SETS, from.tools);
  if (tools === undefined) return sayWhich("tools", TOOL_SETS);
  const answers = oneOf(asked, "answers", ANSWER_SHAPES, from.answers);
  if (answers === undefined) return sayWhich("answers", ANSWER_SHAPES);
  const landOnCode = asked.options.has("land-on-code") || from.landOnCode;
  const without = actsLeftOut(asked);
  if (typeof without === "string") return without;
  return { doctrine, tools, answers, landOnCode, without };
}

/** The acts `--without` named, or the words to say where one is no act. */
function actsLeftOut(asked: Asked): ChatToolName[] | string {
  const said = asked.options.get("without");
  if (said === undefined) return [];
  const named = said === true ? [] : said.split(",").filter((one) => one);
  const acts = named.map((one) => CHAT_TOOLS.find((act) => act === one));
  if (named.length === 0 || acts.includes(undefined))
    return `Say which acts to leave out, of: ${CHAT_TOOLS.join(", ")}`;
  return acts.filter((act) => act !== undefined);
}

/** The value `--<name>` named, `fallback` where it named none, and absent
 *  where it named one there is not. */
function oneOf<Value extends string>(
  asked: Asked,
  name: string,
  values: readonly Value[],
  fallback: Value,
): Value | undefined {
  const said = asked.options.get(name);
  if (said === undefined) return fallback;
  return values.find((one) => one === said);
}

function sayWhich(name: string, values: readonly string[]): string {
  return `Say which: --${name} ${values.join(` or --${name} `)}`;
}

/** The tags `--tag` named, or the words to say where one of them is not a tag
 *  — a person typing a tag hears about it rather than losing it quietly. */
function tagsAsked(asked: Asked): Tag[] | string {
  const said = asked.options.get("tag");
  if (said === undefined) return [];
  if (said === true) return "Say which tags: --tag one,two";
  const held: Tag[] = [];
  for (const one of said.split(",")) {
    if (one.trim() === "") continue;
    const tag = TagSchema.safeParse(one);
    if (!tag.success) return tag.error.issues[0].message;
    held.push(tag.data);
  }
  return held;
}

const NAME_THE_BRANCH =
  "Name the draft to review: --review sloppy/organise/<day>.";
const NOTHING_PROPOSED = "Every note already hangs where it relates best.";
const NO_VERSION = "That version is not in this project's history.";
const NOT_A_BUDGET = "Say the most to spend in dollars: --budget 1.";

async function organising(
  asked: Asked,
  context: CliContext,
  json: boolean,
): Promise<number> {
  const { told } = context;
  const found = await projectAbove(
    context,
    folderNamed(context, asked.paths[0]),
  );
  if (!found) return nothingDone("organise", told, json, NO_NOTES);
  const review = asked.options.get("review");
  if (review === true) {
    return nothingDone("organise", told, json, NAME_THE_BRANCH);
  }
  if (review !== undefined) return reviewing(found.root, review, told, json);
  const api = placeApi(found.files);
  const here = await notesHere(api);
  const only = await notesAsked(asked, found.root, here);
  if (typeof only === "string") {
    return nothingDone("organise", told, json, only);
  }
  const writer = await api.writer.catch(() => undefined);
  const proposals = proposalsFor(here, {
    ...(only === undefined ? {} : { only }),
    loose: asked.options.has("loose"),
    ...(writer === undefined ? {} : { writer }),
  });
  const agent = asked.options.get("agent");
  if (agent === undefined) {
    if (json) told.out(JSON.stringify({ command: "organise", ...proposals }));
    else for (const line of proposalLines(proposals)) told.out(line);
    return proposed(proposals) ? TO_FIX : FINE;
  }
  const which = ORGANISING_AGENTS.find((one) => one === agent);
  if (which === undefined) {
    return nothingDone(
      "organise",
      told,
      json,
      sayWhich("agent", ORGANISING_AGENTS),
    );
  }
  const budget = budgetAsked(asked);
  if (budget === undefined) {
    return nothingDone("organise", told, json, NOT_A_BUDGET);
  }
  if (!proposed(proposals)) {
    return nothingDone("organise", told, json, NOTHING_PROPOSED);
  }
  const model = asked.options.get("model");
  const command = context.agentAt?.[which];
  const done = await organiseWithAgent({
    project: found.root,
    proposals,
    agent: which,
    ...(command === undefined ? {} : { command }),
    self: context.self ?? { command: "sloppy", args: [] },
    ...(typeof model === "string" ? { model } : {}),
    budgetUsd: budget,
    on: new Date(),
  });
  const read =
    done.branch === undefined
      ? undefined
      : await reviewOf(found.root, done.branch);
  if (json) {
    told.out(
      JSON.stringify({
        command: "organise",
        proposals,
        ...done,
        ...(read === undefined
          ? {}
          : { difference: read.difference, lines: read.lines }),
      }),
    );
    return FINE;
  }
  for (const line of done.said.trim().split("\n")) {
    if (line.trim() !== "") told.out(line);
  }
  if (done.stopped) told.out("The agent stopped before it was done.");
  if (done.costUsd !== undefined) {
    told.out(`It cost $${done.costUsd.toFixed(2)}.`);
  }
  if (read === undefined) {
    told.out("It changed nothing, so there is no draft to review.");
    return FINE;
  }
  told.out("");
  for (const line of reviewLines(read)) told.out(line);
  told.out("");
  told.out(
    `The draft is the branch ${read.branch}. Your own notes are as they were.`,
  );
  told.out(`Read it again with: sloppy organise --review ${read.branch}`);
  told.out(`Take it with: git merge ${read.branch}`);
  return FINE;
}

async function reviewing(
  root: string,
  branch: string,
  told: Told,
  json: boolean,
): Promise<number> {
  const read = await reviewOf(root, branch);
  if (json) {
    told.out(
      JSON.stringify({
        command: "organise",
        branch,
        difference: read.difference,
        lines: read.lines,
      }),
    );
    return FINE;
  }
  const lines = reviewLines(read);
  if (lines.length === 0) told.out("That draft changes nothing.");
  for (const line of lines) told.out(line);
  return FINE;
}

function proposed(proposals: Proposals): boolean {
  return proposals.moves.length > 0 || proposals.links.length > 0;
}

/** The notes `--notes` or `--since` named, absent where neither did, and the
 *  words to say where what they named is not here. */
async function notesAsked(
  asked: Asked,
  root: string,
  here: readonly NoteHere[],
): Promise<Set<OwnedRef> | string | undefined> {
  const refs = here.map((held) => held.note.ref);
  const byUlid = (ulid: string) =>
    refs.find((ref) => ref === ulid || ref.endsWith(`/${ulid}`));
  const only = new Set<OwnedRef>();
  const named = asked.options.get("notes");
  if (named === true) return "Say which notes: --notes <ref>,<ref>.";
  if (named !== undefined) {
    for (const one of named.split(",").map((held) => held.trim())) {
      if (one === "") continue;
      const ref = byUlid(one);
      if (ref === undefined) return `There is no note here at ${one}.`;
      only.add(ref);
    }
  }
  const since = asked.options.get("since");
  if (since === true) return "Say since which version: --since <commit>.";
  if (since !== undefined) {
    const changed = await changedSince(root, since);
    if (changed === undefined) return NO_VERSION;
    for (const ulid of changed) {
      const ref = byUlid(ulid);
      if (ref !== undefined) only.add(ref);
    }
  }
  return named === undefined && since === undefined ? undefined : only;
}

/** The ULIDs of the notes whose files changed since `commit`, kept or not;
 *  absent where the history has no such version. */
async function changedSince(
  root: string,
  commit: string,
): Promise<string[] | undefined> {
  const { top, prefix } = await keptIn(root);
  const notes = `${prefix === "" ? "" : `${prefix}/`}${CONTAINER_DIR}/${NOTES_DIR}`;
  const known = await git(top, ["rev-parse", "--verify", `${commit}^{commit}`])
    .then(() => true)
    .catch(() => false);
  if (!known) return undefined;
  const changed = await git(top, [
    "diff",
    "--name-only",
    "-z",
    commit,
    "--",
    notes,
  ]);
  const fresh = await git(top, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    notes,
  ]);
  return `${changed}${fresh}`
    .split("\0")
    .filter((path) => path.endsWith(".md"))
    .map((path) => path.slice(path.lastIndexOf("/") + 1, -".md".length));
}

function budgetAsked(asked: Asked): number | undefined {
  const said = asked.options.get("budget");
  if (said === undefined) return DEFAULT_BUDGET_USD;
  const budget = said === true ? Number.NaN : Number(said);
  return Number.isFinite(budget) && budget > 0 ? budget : undefined;
}

function cited(note: NoteNamed): string {
  return note.address === undefined
    ? `“${note.title}”`
    : `${note.address} “${note.title}”`;
}

function counted(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

function proposalLines(proposals: Proposals): string[] {
  const { moves, links } = proposals;
  if (moves.length === 0 && links.length === 0) return [NOTHING_PROPOSED];
  const lines: string[] = [];
  for (const move of moves) {
    lines.push(
      `Move ${cited(move)} from under ${cited(move.from)} (${move.from.score}) to under ${cited(move.to)} (${move.to.score}): ${move.to.reasons.join("; ")}.`,
    );
    if (move.byPerson) lines.push("  A person has written in it.");
  }
  for (const link of links) {
    lines.push(
      `Link ${cited(link)} and ${cited(link.to)} (${link.score}), as “${link.label}”: ${link.reasons.join("; ")}.`,
    );
  }
  lines.push(
    "",
    `${counted(moves.length, "move", "moves")} and ${counted(links.length, "line", "lines")} proposed. Nothing was changed.`,
    "To have an agent judge them in a draft of their own: sloppy organise --agent claude-code",
  );
  return lines;
}
