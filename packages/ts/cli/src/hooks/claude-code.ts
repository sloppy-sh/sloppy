// `sloppy hook`: the window composed for each prompt Claude Code is given in a
// project with notes, and put in front of its model as context — note 1e12c.
// It writes nothing; the notes are written through `sloppy mcp`.

import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import {
  charsOver4,
  composeWindow,
  containerApi,
  type Files,
  landsOn,
  notesHere,
  windowText,
} from "@sloppy/local";
import { type Window, type WindowAsk, WindowAskSchema } from "@sloppy/types";
import { codeReader } from "../code-reader.js";
import { linesOf } from "../mcp.js";
import type { SelfCommand } from "../organise-agent.js";
import {
  type Asked,
  type CliContext,
  FINE,
  NOT_A_WINDOW,
  NOTHING_DONE,
  TO_FIX,
  windowAsked,
} from "../run.js";

/** The project holding notes at or above a folder. */
export type ProjectAbove = (
  from: string,
) => Promise<{ root: string; files: Files } | undefined>;

const ON_PROMPT = "prompt";
const SLOPPY = "sloppy";
const EVENT = "UserPromptSubmit";
const LEAD = "What this project's notes say about that prompt:";
const JOIN = "\n\n";
const UNREAD =
  "The notes could not be read for this prompt; it went ahead without them.";

export async function hooked(
  asked: Asked,
  context: CliContext,
  projectAbove: ProjectAbove,
): Promise<number> {
  const window = windowAsked(asked);
  if (asked.paths[0] !== ON_PROMPT) {
    if (Number.isNaN(window)) {
      context.told.err(NOT_A_WINDOW);
      return NOTHING_DONE;
    }
    for (const line of installLines(
      context.self,
      asked.options.get("window"),
    )) {
      context.told.out(line);
    }
    return FINE;
  }
  // Claude Code holds a prompt back on exit code 2, so nothing here answers
  // with it: a hook that cannot help says why and lets the prompt by.
  if (Number.isNaN(window)) {
    context.told.err(NOT_A_WINDOW);
    return TO_FIX;
  }
  try {
    const submitted = promptOf(
      await whole(context.calls ?? linesOf(process.stdin)),
    );
    if (submitted === undefined) return FINE;
    const ask = WindowAskSchema.safeParse({
      ask: submitted.prompt,
      budget: window - charsOver4(LEAD + JOIN),
    });
    if (!ask.success) return FINE;
    const found = await projectAbove(submitted.cwd ?? context.cwd);
    if (found === undefined) return FINE;
    const added = await windowFor(found.files, ask.data);
    if (added !== "") {
      context.told.out(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: EVENT,
            additionalContext: added,
          },
        }),
      );
    }
    return FINE;
  } catch {
    context.told.err(UNREAD);
    return TO_FIX;
  }
}

async function windowFor(files: Files, ask: WindowAsk): Promise<string> {
  const api = containerApi(files);
  // Each part is counted with the blank line that joins it, so the whole text
  // the model is handed fits the budget and not only its parts.
  const window = await composeWindow(
    api,
    ask,
    (text) => charsOver4(text + JOIN),
    codeReader(),
  );
  const best = bestNoteOf(window);
  if (best === undefined) return "";
  const held = (await notesHere(api)).find((one) => one.note.ref === best);
  if (held === undefined || !landsOn(held, ask.ask)) return "";
  const text = windowText(window);
  return text === "" ? "" : `${LEAD}${JOIN}${text}`;
}

function bestNoteOf(window: Window): string | undefined {
  return [...window.parts, ...window.cut].find((part) => part.kind === "note")
    ?.ref;
}

async function whole(
  lines: AsyncIterable<string> | Iterable<string>,
): Promise<string> {
  const held: string[] = [];
  for await (const line of lines) held.push(line);
  return held.join("\n");
}

/** The prompt and the folder it was given in, from what Claude Code sends a
 *  hook; absent where that is not a prompt. */
function promptOf(input: string): { prompt: string; cwd?: string } | undefined {
  let event: unknown;
  try {
    event = JSON.parse(input);
  } catch {
    return undefined;
  }
  if (typeof event !== "object" || event === null) return undefined;
  const { prompt, cwd } = event as Record<string, unknown>;
  if (typeof prompt !== "string") return undefined;
  return typeof cwd === "string" ? { prompt, cwd } : { prompt };
}

function installLines(
  self: SelfCommand | undefined,
  window: string | true | undefined,
): string[] {
  const command = [
    ...(self === undefined || onPath(SLOPPY)
      ? [SLOPPY]
      : [self.command, ...self.args]),
    "hook",
    ON_PROMPT,
    ...(typeof window === "string" ? ["--window", window] : []),
  ]
    .map(quoted)
    .join(" ");
  const settings = {
    hooks: { [EVENT]: [{ hooks: [{ type: "command", command }] }] },
  };
  return [
    "Add this to .claude/settings.json in a project, or to ~/.claude/settings.json",
    "for every project, and each prompt you give Claude Code there arrives with",
    "what the notes say about it:",
    "",
    ...JSON.stringify(settings, null, 2).split("\n"),
  ];
}

/** Whether a command by that name runs from any folder, so a settings entry
 *  naming it outlives the install it was printed from. */
function onPath(name: string): boolean {
  return (process.env.PATH ?? "")
    .split(delimiter)
    .filter((folder) => folder !== "")
    .some((folder) => {
      try {
        accessSync(join(folder, name), constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
}

function quoted(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word)
    ? word
    : `'${word.replaceAll("'", `'\\''`)}'`;
}
