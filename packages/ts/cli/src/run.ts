// What `sloppy <command>` does — docs/ARCHITECTURE.md § "Tooling and the
// review". One dispatcher, given where it is and somewhere to write, so the
// same run is exercised by a test and by the bin beside this file.

import { containerOf, type Files } from "@sloppy/local";
import { GRAPH_FILE, VaultFormatError } from "@sloppy/vault";
import { check } from "./check.js";
import { NodeFiles } from "./node-files.js";

export const COMMANDS = ["init", "draft", "review", "check"] as const;
export type Command = (typeof COMMANDS)[number];

/** Nothing to fix. */
export const FINE = 0;
/** Something to fix, listed. */
export const TO_FIX = 1;
/** Nothing done: a command that is not here yet, or one nobody has. */
export const NOTHING_DONE = 2;

export interface Told {
  out(line: string): void;
  err(line: string): void;
}

export interface CliContext {
  /** The folder the command was run in. */
  cwd: string;
  told: Told;
  /** Where a folder is reached; absent is this disk. */
  filesAt?: (root: string) => Files;
}

/** `--name` is `true`, `--name=value` is the value. */
export interface Asked {
  command?: string;
  paths: string[];
  options: Map<string, string | true>;
}

export function parse(argv: readonly string[]): Asked {
  const paths: string[] = [];
  const options = new Map<string, string | true>();
  for (const held of argv) {
    if (!held.startsWith("-")) {
      paths.push(held);
      continue;
    }
    const name = held.replace(/^--?/, "");
    const at = name.indexOf("=");
    if (at === -1) options.set(name, true);
    else options.set(name.slice(0, at), name.slice(at + 1));
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
  "  sloppy draft [paths…]  a note in detail per file named, written as an offer",
  "  sloppy review [dir]    what the code has left behind",
  "  sloppy check [dir]     read every note and say what doesn't hold",
  "",
  "  --json                 answer in JSON instead of lines",
  "  --help                 this",
];

export async function run(
  argv: readonly string[],
  context: CliContext,
): Promise<number> {
  const asked = parse(argv);
  const { told } = context;
  if (asked.options.has("help") || asked.options.has("h") || !asked.command) {
    for (const line of USAGE) told.out(line);
    return asked.command ? FINE : NOTHING_DONE;
  }
  const command = COMMANDS.find((held) => held === asked.command);
  if (!command) {
    told.err(`No such command: ${asked.command}`);
    for (const line of USAGE) told.out(line);
    return NOTHING_DONE;
  }
  const json = asked.options.has("json");
  if (command !== "check") {
    // The tracks that write these replace the answer; until then it says so
    // rather than doing half of one.
    told.out(json ? said(command, "Not here yet.") : "Not here yet.");
    return NOTHING_DONE;
  }
  return await checking(asked, context, json);
}

function said(command: Command, line: string): string {
  return JSON.stringify({ command, said: line });
}

/** A run with nothing read and so nothing listed, in whichever answer was asked
 *  for. */
function nothingDone(told: Told, json: boolean, line: string): number {
  if (json) told.out(said("check", line));
  else told.err(line);
  return NOTHING_DONE;
}

/** The container a command works in: the one inside the folder named, or that
 *  folder itself where it is already a vault. */
async function containerAt(
  root: Files,
): Promise<{ container: Files } | { said: string }> {
  const inside = await containerOf(root);
  if (inside) return { container: inside };
  if (await root.exists(GRAPH_FILE)) return { container: root };
  return { said: "There are no notes in that folder yet." };
}

async function checking(
  asked: Asked,
  context: CliContext,
  json: boolean,
): Promise<number> {
  const at = asked.paths[0] ?? context.cwd;
  const files = (context.filesAt ?? ((root) => new NodeFiles({ root })))(at);
  const held = await containerAt(files);
  if ("said" in held) return nothingDone(context.told, json, held.said);
  let result: Awaited<ReturnType<typeof check>>;
  try {
    result = await check(held.container);
  } catch (thrown) {
    // A VaultFormatError says which folder this is in words already meant for a
    // person; anything else is this machine's own trouble, and its words are not.
    return nothingDone(
      context.told,
      json,
      thrown instanceof VaultFormatError
        ? thrown.message
        : "That folder wouldn't open. Check the path, and that it's yours to read.",
    );
  }
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
