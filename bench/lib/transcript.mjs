// A run's raw event stream, kept beside its record; README.md § "The record" is the doc of record.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export const REDACTED = "[redacted]";

/** Names of environment variables whose values a transcript never holds. */
const SECRET_NAME = /KEY|TOKEN|SECRET|PASSW|CREDENTIAL|AUTH|COOKIE|SESSION/i;

/** Credentials recognised by their shape, wherever they turn up. */
const SECRET_SHAPES = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /xox[abprs]-[A-Za-z0-9-]{10,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /AIza[0-9A-Za-z_-]{30,}/g,
];

/** Values of the secret-named variables in `env`, longest first so a value inside another is not left half-shown. */
export function secretsOf(env = process.env) {
  return Object.entries(env)
    .filter(([name, value]) => SECRET_NAME.test(name) && value?.length >= 8)
    .flatMap(([, value]) => [value, JSON.stringify(value).slice(1, -1)])
    .sort((a, b) => b.length - a.length);
}

/** `text` with every secret value and every credential-shaped string replaced. */
export function redact(text, secrets = secretsOf()) {
  let out = text;
  for (const value of secrets) out = out.split(value).join(REDACTED);
  for (const shape of SECRET_SHAPES) out = out.replace(shape, REDACTED);
  return out;
}

export const transcriptFile = (resultsDir, runId) =>
  path.join(resultsDir, "transcripts", `${runId}.jsonl.gz`);

/** Writes `events` (`{ ms, event }` in arrival order) as gzipped JSONL, one event to a line, redacted; returns the path. */
export function writeTranscript(resultsDir, runId, events, { env } = {}) {
  const secrets = secretsOf(env);
  const lines = events.map((e) => redact(JSON.stringify(e), secrets));
  const file = transcriptFile(resultsDir, runId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, zlib.gzipSync(`${lines.join("\n")}\n`, { level: 9 }));
  return file;
}

/** The events of a run's transcript, or undefined where none was kept. */
export function readTranscript(resultsDir, runId) {
  const file = transcriptFile(resultsDir, runId);
  if (!fs.existsSync(file)) return undefined;
  return zlib
    .gunzipSync(fs.readFileSync(file))
    .toString("utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l));
}
