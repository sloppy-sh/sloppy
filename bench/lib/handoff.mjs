// The handoff family's two stages; README.md § "Handoff tasks" is the doc of record.

/** Closes every stage A prompt, the same under every condition and on every task. */
export const HANDOFF_CLOSING = [
  "Nobody else working on this code knows the reason above. Leave it where the next person who works on this code will find it.",
  "Do not run any of the project's code.",
  "When you are done, end your answer with the commit message for your change, after a line that reads exactly: Commit message:",
].join(" ");

/** What a handoff task's stage A is sent. */
export const stageAPrompt = (task) => `${task.prompt_a}\n\n${HANDOFF_CLOSING}`;

export const FALLBACK_COMMIT_MESSAGE = "Change";

const MAX_MESSAGE = 4000;

/**
 * The commit message stage A gave: everything after its last `Commit message:` line (or after the
 * words on that line), fences and surrounding quotes taken off; `Change` where it gave none.
 */
export function commitMessageOf(text) {
  const lines = (text ?? "").split("\n");
  const marker = /^\s*[*_#>`]*\s*commit message\s*[*_`]*\s*:\s*[*_`]*\s*(.*)$/i;
  let at = -1;
  for (let i = lines.length - 1; i >= 0; i--)
    if (marker.test(lines[i])) {
      at = i;
      break;
    }
  if (at === -1) return FALLBACK_COMMIT_MESSAGE;
  const rest = [lines[at].match(marker)[1], ...lines.slice(at + 1)]
    .filter((l) => !/^\s*```/.test(l))
    .join("\n")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
  return rest ? rest.slice(0, MAX_MESSAGE) : FALLBACK_COMMIT_MESSAGE;
}
