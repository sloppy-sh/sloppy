import { describe, expect, it } from "vitest";
import {
  HARNESS_STOPS,
  HarnessActSchema,
  HarnessBudgetSchema,
  HarnessRunSchema,
  HarnessStopSchema,
  HarnessTurnSchema,
  KeySourceKindSchema,
} from "./harness.js";

const SPENT = { sent: 1200, answered: 90, recalled: 800 };

const ANSWERED = {
  act: "read_note",
  input: { address: "1a" },
  outcome: "answered",
  answer: "# Sowing\n\nFirst, because the frost.",
} as const;

const REFUSED = {
  act: "read_note",
  input: { address: "9z" },
  outcome: "refused",
  reason: "There is no note at 9z.",
} as const;

const TURN = {
  sent: "The window.",
  reply: "Reading 1a.",
  acts: [ANSWERED],
  spent: SPENT,
};

const RUN = {
  ask: { ask: "Why sow first?", budget: 8000, depth: 3 },
  model: "a-model",
  budget: { turns: 8 },
};

describe("an act the model asked for", () => {
  it("is answered or refused", () => {
    expect(HarnessActSchema.parse(ANSWERED)).toEqual(ANSWERED);
    expect(HarnessActSchema.parse(REFUSED)).toEqual(REFUSED);
  });

  it("refuses an answered act with no answer, and one with no name", () => {
    const { answer: _, ...unanswered } = ANSWERED;
    expect(HarnessActSchema.safeParse(unanswered).success).toBe(false);
    expect(HarnessActSchema.safeParse({ ...ANSWERED, act: "" }).success).toBe(
      false,
    );
  });
});

describe("a turn", () => {
  it("parses what was sent, what came back, the acts and the tokens", () => {
    expect(HarnessTurnSchema.parse(TURN)).toEqual(TURN);
    const answer = { ...TURN, acts: [] };
    expect(HarnessTurnSchema.parse(answer)).toEqual(answer);
  });

  it("refuses a turn that does not say what it spent", () => {
    const { spent: _, ...untold } = TURN;
    expect(HarnessTurnSchema.safeParse(untold).success).toBe(false);
  });
});

describe("a run's budget", () => {
  it("names turns, spend, or both", () => {
    for (const budget of [
      { turns: 8 },
      { spend: 0.5 },
      { turns: 8, spend: 0.5 },
    ]) {
      expect(HarnessBudgetSchema.parse(budget)).toEqual(budget);
    }
  });

  it("refuses a budget naming neither, and a limit of nothing", () => {
    expect(HarnessBudgetSchema.safeParse({}).success).toBe(false);
    expect(HarnessBudgetSchema.safeParse({ turns: 0 }).success).toBe(false);
    expect(HarnessBudgetSchema.safeParse({ spend: 0 }).success).toBe(false);
  });
});

describe("a run", () => {
  it("ends for one of the known reasons", () => {
    for (const stop of HARNESS_STOPS) {
      expect(HarnessStopSchema.parse(stop)).toBe(stop);
    }
    expect(HarnessStopSchema.safeParse("timeout").success).toBe(false);
  });

  it("parses a run that ended without trouble", () => {
    const run = {
      ...RUN,
      turns: [TURN, { ...TURN, acts: [] }],
      stop: "answered",
    };
    expect(HarnessRunSchema.parse(run)).toEqual(run);
  });

  it("says what went wrong only when it ended in error", () => {
    const failed = {
      ...RUN,
      turns: [],
      stop: "error",
      error: "Check the key and try again.",
    };
    expect(HarnessRunSchema.parse(failed)).toEqual(failed);
    expect(
      HarnessRunSchema.safeParse({ ...RUN, turns: [], stop: "error" }).success,
    ).toBe(false);
    expect(
      HarnessRunSchema.parse({
        ...RUN,
        turns: [],
        stop: "turns_spent",
        error: "x",
      }),
    ).toEqual({ ...RUN, turns: [], stop: "turns_spent" });
  });

  it("refuses a run that does not name its model", () => {
    const { model: _, ...unnamed } = RUN;
    expect(
      HarnessRunSchema.safeParse({ ...unnamed, turns: [], stop: "answered" })
        .success,
    ).toBe(false);
  });
});

describe("where a key comes from", () => {
  it("is the environment or the keychain", () => {
    expect(KeySourceKindSchema.parse("environment")).toBe("environment");
    expect(KeySourceKindSchema.parse("keychain")).toBe("keychain");
    expect(KeySourceKindSchema.safeParse("file").success).toBe(false);
  });
});
