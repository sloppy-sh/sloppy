import { describe, expect, it } from "vitest";
import {
  advertisedBuildTools,
  BUILD_LINE_PREFIX,
  BUILD_NAME_MAX,
  BUILD_ROLES,
  BUILD_ROUNDS_MOST,
  BUILD_TASK_BRANCH_PREFIX,
  BUILD_TOOL_SPECS,
  buildLine,
  BuildHandoffSchema,
  BuildNameSchema,
  buildNameFrom,
  BuildPlanSchema,
  BuildReviewSchema,
  BuildSchema,
  BuildStandingSchema,
  buildTaskBranch,
  buildTaskIn,
  BuildToolCallSchema,
  MOST_TASKS,
  SloppyToolCallSchema,
  toolsForRole,
} from "./build.js";
import { BUILD_TOOLS, CHAT_TOOLS, chatToolWrites } from "./chat.js";
import { ulid } from "./codecs.js";

const note = () => `did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE/${ulid()}`;

const plan = {
  tasks: [
    {
      id: "reader",
      title: "Read the file by the line",
      effect:
        "The reader hands back the sections in the order the file has them, so the rest of the app never parses markdown twice.",
      paths: ["packages/ts/vault/src/markdown.ts"],
      notes: [note()],
    },
  ],
  needs: [
    {
      id: "units",
      question: "What should a run of lines with no end be read as?",
      why: "The anchor cannot be resolved without it.",
    },
  ],
  disputes: [],
  checks: ["pnpm check"],
};

describe("the plan a reading session answers with", () => {
  it("carries the tasks, the questions and the commands", () => {
    expect(BuildPlanSchema.parse(plan)).toEqual(plan);
  });

  it("refuses a plan with no task, and a task with no note", () => {
    expect(BuildPlanSchema.safeParse({ ...plan, tasks: [] }).success).toBe(
      false,
    );
    expect(
      BuildPlanSchema.safeParse({
        ...plan,
        tasks: [{ ...plan.tasks[0], notes: [] }],
      }).success,
    ).toBe(false);
  });

  it("refuses a task whose territory climbs out of the project", () => {
    expect(
      BuildPlanSchema.safeParse({
        ...plan,
        tasks: [{ ...plan.tasks[0], paths: ["../elsewhere/src"] }],
      }).success,
    ).toBe(false);
  });

  it("refuses an id that is not a slug", () => {
    expect(
      BuildPlanSchema.safeParse({
        ...plan,
        tasks: [{ ...plan.tasks[0], id: "The Reader" }],
      }).success,
    ).toBe(false);
  });
});

describe("the hand-off a session ends with", () => {
  const handoff = {
    summary: "The reader reads a file by the line.",
    files: ["packages/ts/vault/src/markdown.ts"],
    checks: [{ command: "pnpm check", passed: true, said: "" }],
    notes: [note()],
    undone: "",
    finished: true,
  };

  it("carries what was built, the checks and what they said", () => {
    expect(BuildHandoffSchema.parse(handoff)).toEqual(handoff);
  });

  it("takes a session handing on part-way with nothing left to say", () => {
    expect(
      BuildHandoffSchema.parse({
        ...handoff,
        finished: false,
        files: [],
        checks: [],
        notes: [],
      }).finished,
    ).toBe(false);
  });

  it("refuses one that says nothing", () => {
    expect(
      BuildHandoffSchema.safeParse({ ...handoff, summary: "" }).success,
    ).toBe(false);
  });
});

describe("a review", () => {
  it("is clean with nothing found", () => {
    expect(BuildReviewSchema.parse({ clean: true, findings: [] })).toEqual({
      clean: true,
      findings: [],
    });
  });

  it("carries a place and a severity per finding", () => {
    const review = {
      clean: false,
      findings: [
        {
          file: "packages/ts/vault/src/markdown.ts",
          line: 120,
          severity: "blocking" as const,
          what: "A section with no opener is dropped.",
          why: "Writing somebody did is lost with no error.",
        },
      ],
    };
    expect(BuildReviewSchema.parse(review)).toEqual(review);
  });

  it("refuses a severity nothing reads", () => {
    expect(
      BuildReviewSchema.safeParse({
        clean: false,
        findings: [
          {
            file: "a.ts",
            severity: "nit",
            what: "x",
            why: "y",
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("which acts a role is handed", () => {
  const reading = CHAT_TOOLS.filter((act) => !chatToolWrites(act));
  const writing = CHAT_TOOLS.filter((act) => chatToolWrites(act));

  it("gives every role the chat's reading acts", () => {
    for (const role of BUILD_ROLES) {
      const held = toolsForRole(role);
      for (const act of reading) expect(held).toContain(act);
    }
  });

  it("gives the chat's writing acts to an implementer alone", () => {
    for (const role of BUILD_ROLES) {
      const held = toolsForRole(role);
      for (const act of writing) {
        expect(held.includes(act)).toBe(role === "implementer");
      }
    }
  });

  it("gives each role its own acts and no other role's", () => {
    expect(toolsForRole("planner")).toContain("plan_build");
    expect(toolsForRole("planner")).toContain("raise_need");
    expect(toolsForRole("planner")).not.toContain("hand_off");
    expect(toolsForRole("implementer")).toContain("hand_off");
    expect(toolsForRole("implementer")).not.toContain("plan_build");
    expect(toolsForRole("implementer")).not.toContain("review_build");
    expect(toolsForRole("reviewer")).toContain("review_build");
    expect(toolsForRole("reviewer")).not.toContain("hand_off");
    expect(toolsForRole("merger")).toContain("hand_off");
    expect(toolsForRole("merger")).not.toContain("raise_need");
    expect(toolsForRole("merger")).not.toContain("review_build");
  });

  it("names nothing twice", () => {
    for (const role of BUILD_ROLES) {
      const held = toolsForRole(role);
      expect(new Set(held).size).toBe(held.length);
    }
  });

  it("writes no note with any of the build's own acts", () => {
    for (const act of BUILD_TOOLS) {
      expect(BUILD_TOOL_SPECS[act].writes).toBe(false);
    }
  });
});

describe("what a role is advertised", () => {
  it("is exactly what its calls are held to", () => {
    for (const role of BUILD_ROLES) {
      const shown = advertisedBuildTools(role);
      expect(shown.map((tool) => tool.name)).toEqual([...toolsForRole(role)]);
      for (const tool of shown) {
        expect(tool.description.length).toBeGreaterThan(0);
        expect(tool.arguments).not.toHaveProperty("$schema");
      }
    }
  });

  it("tells a reviewer that clean with nothing found is an answer", () => {
    const reading = advertisedBuildTools("reviewer").find(
      (tool) => tool.name === "review_build",
    );
    expect(reading?.description).toContain(
      "Clean with nothing found is the right answer",
    );
  });

  it("describes the plan it asks for", () => {
    const planning = advertisedBuildTools("planner").find(
      (tool) => tool.name === "plan_build",
    );
    expect(planning?.arguments).toHaveProperty("properties.tasks");
    expect(planning?.arguments).toHaveProperty("properties.checks");
  });
});

describe("a call of one of a build's acts", () => {
  const call = "call_1";

  it("names an arm for every act a build adds", () => {
    const armed = BuildToolCallSchema.options.map(
      (arm) => arm.shape.act.value as string,
    );

    expect(armed.sort()).toEqual([...BUILD_TOOLS].sort());
  });

  it("is parsed by the one union a seam serves calls through", () => {
    const asked = { call, act: "plan_build", arguments: plan };
    expect(SloppyToolCallSchema.parse(asked)).toEqual(asked);

    const reading = { call, act: "list_notes", arguments: {} };
    expect(SloppyToolCallSchema.safeParse(reading).success).toBe(true);
  });

  it("refuses one in the words of its own shape", () => {
    const refused = SloppyToolCallSchema.safeParse({
      call,
      act: "review_build",
      arguments: { clean: "yes", findings: [] },
    });

    expect(refused.success).toBe(false);
    expect(refused.error?.issues[0]?.path).toEqual(["arguments", "clean"]);
  });
});

describe("what a build is called", () => {
  it("takes a name a line of git's can carry", () => {
    expect(BuildNameSchema.parse("lines-by-the-line")).toBe(
      "lines-by-the-line",
    );
    expect(BuildNameSchema.safeParse("a".repeat(BUILD_NAME_MAX)).success).toBe(
      true,
    );
    for (const said of [
      "lines by the line",
      "Lines",
      "-lines",
      "lines..line",
      "lines~line",
      "lines:line",
      "lines?line",
      "lines.lock",
      "",
      "a".repeat(BUILD_NAME_MAX + 1),
    ]) {
      expect(BuildNameSchema.safeParse(said).success).toBe(false);
    }
  });

  it("says in words what a name may be", () => {
    const refused = BuildNameSchema.safeParse("Lines by the line");
    expect(refused.error?.issues[0]?.message).toContain("lowercase letters");
  });

  it("makes a name out of what a person typed", () => {
    expect(buildNameFrom("Lines by the line")).toBe("lines-by-the-line");
    expect(buildNameFrom("  the reader's own words!  ")).toBe(
      "the-reader-s-own-words",
    );
    expect(buildNameFrom("Sets — the tags as places")).toBe(
      "sets-the-tags-as-places",
    );
  });

  it("makes one the line can be named after, whatever was typed", () => {
    for (const said of [
      "Lines by the line",
      "..lines..",
      "~lines:line?",
      "a".repeat(BUILD_NAME_MAX * 2),
      "the reader's own words",
    ]) {
      const name = buildNameFrom(said);
      expect(name).toBeDefined();
      expect(BuildNameSchema.safeParse(name).success).toBe(true);
      expect(buildLine(name as string)).toBe(`${BUILD_LINE_PREFIX}${name}`);
    }
  });

  it("makes none where nothing typed could be one", () => {
    for (const said of ["", "   ", "...", "—", "???"]) {
      expect(buildNameFrom(said)).toBeUndefined();
    }
  });
});

describe("the branches a build writes on", () => {
  it("names the line after the build", () => {
    expect(buildLine("lines-by-the-line")).toBe(
      `${BUILD_LINE_PREFIX}lines-by-the-line`,
    );
  });

  it("reads a task's branch back to the build and the task", () => {
    const id = ulid();
    const branch = buildTaskBranch(id, "reader");
    expect(branch.startsWith(BUILD_TASK_BRANCH_PREFIX)).toBe(true);
    expect(buildTaskIn(branch)).toEqual({ id, task: "reader" });
  });

  it("names no task where the branch is somebody's own", () => {
    expect(buildTaskIn("main")).toBeUndefined();
    expect(buildTaskIn(buildLine("feature"))).toBeUndefined();
    expect(buildTaskIn(`${BUILD_TASK_BRANCH_PREFIX}${ulid()}`)).toBeUndefined();
    expect(
      buildTaskIn(`${BUILD_TASK_BRANCH_PREFIX}nope/reader`),
    ).toBeUndefined();
    expect(
      buildTaskIn(`${BUILD_TASK_BRANCH_PREFIX}${ulid()}/reader/again`),
    ).toBeUndefined();
  });
});

describe("the build a device keeps", () => {
  const build = {
    id: ulid(),
    graph: note(),
    project: "/code/sloppy",
    about: [note()],
    name: "lines-by-the-line",
    line: buildLine("lines-by-the-line"),
    from: "0123456789abcdef0123456789abcdef01234567",
    state: "building" as const,
    plan,
    answers: { units: { note: note() }, other: { dropped: true as const } },
    tasks: {
      reader: {
        state: "reviewing" as const,
        handoffs: [
          {
            summary: "Read by the line.",
            files: ["packages/ts/vault/src/markdown.ts"],
            checks: [],
            notes: [],
            undone: "",
            finished: true,
          },
        ],
        needs: [],
        rounds: 0,
      },
    },
    sessions: [
      { conversation: ulid(), role: "planner" as const },
      { conversation: ulid(), role: "implementer" as const, task: "reader" },
    ],
    merges: [{ task: "reader", settled: false, conflicts: [] }],
    created: "2026-10-13T10:00:00.000Z",
  };

  it("carries the line, the plan, the answers and the tasks", () => {
    expect(BuildSchema.parse(build)).toEqual(build);
  });

  it("takes one whose reading session has not answered yet", () => {
    const { plan: _plan, ...rest } = build;
    expect(
      BuildSchema.parse({ ...rest, state: "reading" }).plan,
    ).toBeUndefined();
  });

  it("refuses more rounds than a task is given", () => {
    expect(
      BuildSchema.safeParse({
        ...build,
        tasks: {
          reader: { ...build.tasks.reader, rounds: BUILD_ROUNDS_MOST + 1 },
        },
      }).success,
    ).toBe(false);
  });

  it("holds a question a task raised on that task, and the task on it", () => {
    const held = BuildSchema.parse({
      ...build,
      tasks: {
        reader: {
          ...build.tasks.reader,
          state: "asking",
          needs: [
            {
              id: "ends",
              about: note(),
              question: "What ends a section with no closer?",
              why: "The reader cannot split the file without it.",
            },
          ],
        },
      },
    });
    expect(held.tasks.reader?.state).toBe("asking");
    expect(held.tasks.reader?.needs[0]?.id).toBe("ends");
    expect(held.plan?.needs.map((need) => need.id)).toEqual(["units"]);
  });

  it("keeps a row per session, saying which conversation it was", () => {
    const kept = BuildSchema.parse(build).sessions;
    expect(kept.map((session) => session.role)).toEqual([
      "planner",
      "implementer",
    ]);
    expect(kept[0]?.task).toBeUndefined();
    expect(kept[1]?.task).toBe("reader");
    expect(new Set(kept.map((session) => session.conversation)).size).toBe(2);
  });

  it("refuses a state nothing reads and a build about nothing", () => {
    expect(BuildSchema.safeParse({ ...build, state: "hand_off" }).success).toBe(
      false,
    );
    expect(BuildSchema.safeParse({ ...build, about: [] }).success).toBe(false);
  });
});

describe("a build standing", () => {
  const standing = {
    id: ulid(),
    line: buildLine("lines-by-the-line"),
    path: "/data/builds/one/line",
    from: "0123456789abcdef0123456789abcdef01234567",
    tasks: [{ task: "reader", path: "/data/builds/one/reader" }],
  };

  it("carries the line, its checkout and the tasks still there", () => {
    expect(BuildStandingSchema.parse(standing)).toEqual(standing);
  });

  it("takes one with no task checkout left", () => {
    expect(BuildStandingSchema.parse({ ...standing, tasks: [] }).tasks).toEqual(
      [],
    );
  });

  it("refuses more tasks than a build holds", () => {
    expect(
      BuildStandingSchema.safeParse({
        ...standing,
        tasks: Array.from({ length: MOST_TASKS + 1 }, (_, at) => ({
          task: `task-${at}`,
          path: `/data/builds/one/task-${at}`,
        })),
      }).success,
    ).toBe(false);
  });
});
