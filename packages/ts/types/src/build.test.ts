import { describe, expect, it } from "vitest";
import {
  advertisedBuildTools,
  BUILD_LINE_PREFIX,
  BUILD_ROLES,
  BUILD_ROUNDS_MOST,
  BUILD_TASK_BRANCH_PREFIX,
  BUILD_TOOL_SPECS,
  BUILD_TOOLS,
  buildLine,
  BuildHandoffSchema,
  BuildPlanSchema,
  BuildReviewSchema,
  BuildSchema,
  BuildStandingSchema,
  buildTaskBranch,
  buildTaskIn,
  MOST_TASKS,
  toolsForRole,
} from "./build.js";
import { CHAT_TOOLS, chatToolWrites } from "./chat.js";
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
    expect(toolsForRole("planner")).toContain("need");
    expect(toolsForRole("planner")).not.toContain("done");
    expect(toolsForRole("implementer")).toContain("done");
    expect(toolsForRole("implementer")).not.toContain("plan_build");
    expect(toolsForRole("implementer")).not.toContain("review_build");
    expect(toolsForRole("reviewer")).toContain("review_build");
    expect(toolsForRole("reviewer")).not.toContain("done");
    expect(toolsForRole("merger")).toContain("done");
    expect(toolsForRole("merger")).not.toContain("need");
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

  it("describes the plan it asks for", () => {
    const planning = advertisedBuildTools("planner").find(
      (tool) => tool.name === "plan_build",
    );
    expect(planning?.arguments).toHaveProperty("properties.tasks");
    expect(planning?.arguments).toHaveProperty("properties.checks");
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
        rounds: 0,
      },
    },
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

  it("refuses a state nothing reads and a build about nothing", () => {
    expect(BuildSchema.safeParse({ ...build, state: "done" }).success).toBe(
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
