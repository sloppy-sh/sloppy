import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { INSTALLED_BACKENDS } from "./kinds.mjs";

export const BENCH_DIR = path.resolve(import.meta.dirname, "..");

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

export const AgentsSchema = z.object({
  /** Installed backends the person running the suite has allowed; nothing else installed is run. */
  allow_installed: z.array(z.enum(INSTALLED_BACKENDS)),
  installed: z.partialRecord(
    z.enum(INSTALLED_BACKENDS),
    z.object({
      /** Program to run, a name on PATH or an absolute path. */
      command: z.string().min(1),
      /** Extra arguments placed before the backend's own. */
      args: z.array(z.string()).default(() => []),
      /** prices.json provider the agent's model is priced under. */
      provider: z.string().optional(),
    }),
  ),
});

export const ProviderSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  kind: z.enum(["anthropic", "openai-compatible"]),
  /** Endpoint root; absent means the kind's own default. */
  base_url: z.string().url().optional(),
  /** Name of the environment variable holding the key; the key itself is never stored. */
  key_env: z.string().regex(/^[A-Z_][A-Z0-9_]*$/),
  models: z.array(z.string().min(1)).min(1),
});

export const ProvidersSchema = z.object({ providers: z.array(ProviderSchema) });

const SubjectRelPath = z
  .string()
  .min(1)
  .refine(
    (p) => !path.isAbsolute(p) && !p.split(/[\\/]/).includes(".."),
    "must be a path inside the subject",
  );

export const SubjectConfigSchema = z.object({
  /** Subject project, relative to bench/ or absolute. */
  path: z.string().min(1),
  default_pack: z.string().min(1),
  /** Sloppy CLI entry, relative to the subject or absolute; the mcp conditions run `node <it> mcp`. */
  sloppy_cli: z.string().min(1),
  /** The documents: removed by nodocs and notes-only. */
  docs: z.array(SubjectRelPath),
  /** The Sloppy container: removed by nodocs, kept by notes-only. */
  container: SubjectRelPath,
  /** Removed by nodocs and notes-only. */
  mcp_file: SubjectRelPath,
  /** Files every symlink to which nodocs and notes-only remove. */
  context_links: z.array(SubjectRelPath),
  /** The documents of record the pointed conditions name, in order. */
  pointed: z.array(SubjectRelPath).min(1),
  /** Files the dump condition appends, in order. */
  dump: z.array(SubjectRelPath).min(1),
  /** The subject's name as a reader sees it; absent shows its file's name. */
  label: z.string().min(1).optional(),
  /** A project that may not be quoted: the export keeps its numbers under its label and nothing else; absent is false. */
  private: z.boolean().optional(),
  /** Research the project keeps beside its documents, counted in the export and removed by no variant; absent counts none. */
  research: z.array(SubjectRelPath).optional(),
});

export const SUBJECTS_DIR = path.join(BENCH_DIR, "subjects");

/**
 * One entry of `--configs`: `<name>=<sha>[:<cli>][:--arg]...`. The sha holds no colon, so the CLI
 * path may; the trailing segments that start with `--` are what the server is started with after
 * `mcp`, and an empty CLI before them is the subject's own. Absent where `entry` is not one.
 */
export function parseConfig(entry) {
  const m = /^([^=]+)=([^:]+)(?::(.*))?$/.exec(entry);
  if (!m) return undefined;
  const rest = m[3] === undefined ? [] : m[3].split(":");
  const args = [];
  while (rest.length > 0 && rest[rest.length - 1].startsWith("--"))
    args.unshift(rest.pop());
  const cli = rest.join(":");
  return {
    name: m[1],
    sha: m[2],
    ...(cli === "" ? {} : { cli }),
    ...(args.length === 0 ? {} : { args }),
  };
}

/** subject.json names the subject a run takes when none is given. */
const DefaultSubjectSchema = z.object({ default: z.string().min(1) });

export const subjectNames = () =>
  fs
    .readdirSync(SUBJECTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .sort();

/**
 * A subject by name (`subjects/<name>.json`) or by the path of a JSON file, named by its base name;
 * the default subject where `nameOrFile` is absent. `path` comes back absolute.
 */
export function loadSubject(
  nameOrFile,
  { defaultFile = path.join(BENCH_DIR, "subject.json") } = {},
) {
  const ref =
    nameOrFile ?? DefaultSubjectSchema.parse(readJson(defaultFile)).default;
  const file = ref.endsWith(".json")
    ? path.resolve(ref)
    : path.join(SUBJECTS_DIR, `${ref}.json`);
  if (!fs.existsSync(file))
    throw new Error(
      `There is no subject called "${ref}". Choose one of: ${subjectNames().join(", ")}, or give the path of a subject file.`,
    );
  const parsed = SubjectConfigSchema.safeParse(readJson(file));
  if (!parsed.success)
    throw new Error(
      `${file} is not a subject: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(file)"} ${i.message}`).join("; ")}.`,
    );
  const subject = parsed.data;
  if (subject.docs.includes(subject.container))
    throw new Error(
      `${file} lists its container ${subject.container} among its docs, so notes-only would remove the notes too.`,
    );
  return {
    ...subject,
    name: path.basename(file, ".json"),
    path: path.resolve(BENCH_DIR, subject.path),
  };
}

export const loadAgents = (file = path.join(BENCH_DIR, "agents.json")) =>
  AgentsSchema.parse(readJson(file));

export const loadProviders = (file = path.join(BENCH_DIR, "providers.json")) =>
  ProvidersSchema.parse(readJson(file)).providers;
