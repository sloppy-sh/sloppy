// What `sloppy <command>` does — docs/ARCHITECTURE.md § "Tooling". One
// dispatcher, given where it is and somewhere to write, so the same run is
// exercised by a test and by the bin beside this file.

import { basename, dirname, relative, resolve } from "node:path";
import { SloppyApiError } from "@sloppy/client";
import {
  containerDataAt,
  containerOf,
  type Files,
  LocalApi,
} from "@sloppy/local";
import { type Tag, TagSchema } from "@sloppy/types";
import { VaultFormatError } from "@sloppy/vault";
import { check } from "./check.js";
import { containerAt, heldAt } from "./folder.js";
import { draft } from "./draft.js";
import { init, InitRefused } from "./init.js";
import { NodeFiles } from "./node-files.js";
import type { WriteDone } from "./writer.js";

export const COMMANDS = ["init", "draft", "check"] as const;
export type Command = (typeof COMMANDS)[number];

/** Nothing to fix. */
export const FINE = 0;
/** Something to fix, listed. */
export const TO_FIX = 1;
/** Nothing done: a command that is not here yet, or one nobody has. */
export const NOTHING_DONE = 2;

/** The options that take the word after them as their value. */
const VALUED = new Set(["identity", "tag"]);

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
  "",
  "  --identity <file>      write as the identity in that file, rather than one made here",
  "  --tag <a,b>            tag every note it writes, alongside what each already carries",
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
  try {
    switch (command) {
      case "check":
        return await checking(asked, context, json);
      case "init":
        return await starting(asked, context, json);
      case "draft":
        return await drafting(asked, context, json);
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
  const result = await check(container);
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
