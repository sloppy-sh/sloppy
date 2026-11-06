import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConditions, selectConditions } from "../lib/condition.mjs";
import { buildPrompt, pointedLine } from "../lib/prompt.mjs";
import { prepareVariant } from "../lib/subject.mjs";
import { loadPack } from "../lib/task.mjs";
import {
  makeSubject,
  makeDocSiteSubject,
  DOC_SITE_CONFIG,
  tempDir,
  testSubject,
} from "./helpers.mjs";

const set = loadConditions();
const crafted = testSubject();
const docSite = testSubject(DOC_SITE_CONFIG, "doc-site");
const [task] = loadPack("example");

test("conditions.json holds the nine conditions, two of them offering subagents", () => {
  assert.deepEqual(
    set.conditions.map((c) => c.id),
    [
      "nodocs",
      "notes-only",
      "bare",
      "pointed",
      "dump",
      "mcp",
      "mcp+pointed",
      "agents",
      "mcp+agents",
    ],
  );
  assert.deepEqual(
    set.conditions.filter((c) => c.mcp).map((c) => c.id),
    ["notes-only", "mcp", "mcp+pointed", "mcp+agents"],
  );
  assert.deepEqual(
    set.conditions.filter((c) => c.subagents).map((c) => c.id),
    ["agents", "mcp+agents"],
  );
  const byId = Object.fromEntries(set.conditions.map((c) => [c.id, c]));
  const { subagents: _a, id: _i, ...agents } = byId.agents;
  const { subagents: _b, id: _j, ...bare } = byId.bare;
  assert.deepEqual(agents, bare);
  const { subagents: _c, id: _k, ...mcpAgents } = byId["mcp+agents"];
  const { subagents: _d, id: _l, ...mcp } = byId.mcp;
  assert.deepEqual(mcpAgents, mcp);
  assert.deepEqual(
    set.conditions.filter((c) => c.variant === "nodocs").map((c) => c.id),
    ["nodocs"],
  );
});

test("every condition gets the task text verbatim and the same opening", () => {
  const subject = makeSubject();
  const workRoot = tempDir();
  const dirs = {
    full: prepareVariant(subject, "full", "HEAD", { workRoot, subject: crafted }).dir,
    nodocs: prepareVariant(subject, "nodocs", "HEAD", { workRoot, subject: crafted }).dir,
  };
  const built = Object.fromEntries(
    set.conditions.map((condition) => [
      condition.id,
      buildPrompt({
        task,
        condition,
        baseSystem: set.base_system,
        variantDir: dirs[condition.variant],
        dump: crafted.dump,
        pointed: crafted.pointed,
      }),
    ]),
  );
  for (const [id, b] of Object.entries(built)) {
    assert.equal(b.prompt, task.prompt, id);
    assert.ok(b.systemPrompt.startsWith(set.base_system), id);
  }
  assert.equal(built.nodocs.systemPrompt, set.base_system);
  assert.equal(built.bare.systemPrompt, set.base_system);
  assert.equal(
    built.pointed.systemPrompt,
    `${set.base_system}\n\nAI.md and docs/ARCHITECTURE.md are this project's documents of record; read what you need from them.`,
  );
  assert.ok(
    built.mcp.systemPrompt.endsWith("reachable through the sloppy tools."),
  );
  assert.ok(
    built["mcp+pointed"].systemPrompt.includes("read what you need from them."),
  );
  assert.ok(
    built["mcp+pointed"].systemPrompt.endsWith(
      "reachable through the sloppy tools.",
    ),
  );
  for (const file of [
    "AI.md",
    "docs/ARCHITECTURE.md",
    "DESIGN.md",
    "PRODUCT.md",
  ])
    assert.ok(built.dump.systemPrompt.includes(`# ${file}\n\n`), file);
  assert.ok(built.dump.systemPrompt.includes("The ref identifies a note."));
});

test("a dump the variant cannot supply is refused rather than sent short", () => {
  const subject = makeSubject();
  const nodocs = prepareVariant(subject, "nodocs", "HEAD", {
    workRoot: tempDir(),
    subject: crafted,
  }).dir;
  const [dump] = selectConditions(set, ["dump"]);
  assert.throws(
    () =>
      buildPrompt({
        task,
        condition: dump,
        baseSystem: set.base_system,
        variantDir: nodocs,
        dump: crafted.dump,
      }),
    /no such file/,
  );
});

test("an unknown condition is refused by name", () => {
  assert.throws(
    () => selectConditions(set, ["bare", "rag"]),
    /no condition called "rag"/,
  );
});

test("the dump condition appends the subject's own files, in the subject's order", () => {
  const repo = makeDocSiteSubject();
  const site = docSite;
  const dump = [
    "README.md",
    "apps/docs/app/src/routes/architecture/mandates/+page.md",
  ];
  const variantDir = prepareVariant(repo, "full", "HEAD", {
    workRoot: tempDir(),
    subject: site,
  }).dir;
  const [condition] = selectConditions(set, ["dump"]);
  const { systemPrompt } = buildPrompt({
    task,
    condition,
    baseSystem: set.base_system,
    variantDir,
    dump,
  });
  const at = dump.map((f) => systemPrompt.indexOf(`# ${f}\n\n`));
  assert.ok(at.every((i) => i > 0));
  assert.ok(at[0] < at[1]);
  assert.ok(!systemPrompt.includes("# AI.md"));
  assert.ok(!systemPrompt.includes("docs/ARCHITECTURE.md"));
  assert.deepEqual(site.dump.slice(0, 4), [
    "README.md",
    "Architecture.md",
    "DEPLOYMENT.md",
    "AI.md",
  ]);
  assert.ok(site.dump.includes(dump[1]));
});

test("the pointed line names the subject's own documents of record, in the subject's order", () => {
  const site = docSite;
  assert.deepEqual(crafted.pointed, ["AI.md", "docs/ARCHITECTURE.md"]);
  assert.equal(
    pointedLine(crafted.pointed),
    "AI.md and docs/ARCHITECTURE.md are this project's documents of record; read what you need from them.",
  );
  assert.equal(
    pointedLine(site.pointed),
    "AI.md, Architecture.md and apps/docs/app/src/routes are this project's documents of record; read what you need from them.",
  );
  const [both] = selectConditions(set, ["mcp+pointed"]);
  const { systemPrompt } = buildPrompt({
    task,
    condition: both,
    baseSystem: set.base_system,
    variantDir: tempDir(),
    dump: site.dump,
    pointed: site.pointed,
  });
  assert.equal(
    systemPrompt,
    [set.base_system, pointedLine(site.pointed), ...both.lines].join("\n\n"),
  );
  assert.ok(!systemPrompt.includes("docs/ARCHITECTURE.md"));
  for (const c of set.conditions.filter((c) => !c.pointed))
    assert.ok(
      !buildPrompt({
        task,
        condition: c,
        baseSystem: set.base_system,
        variantDir: tempDir(),
        dump: [],
        pointed: site.pointed,
      }).systemPrompt.includes("documents of record"),
      c.id,
    );
});
