import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS,
  DEFAULT_PERMISSIONS,
  type OverrideFacts,
  Permissions,
  type RoleFacts,
  constantPermissionFold,
  hasPermission,
  hasPolicy,
  maskBits,
  maskOf,
  overrideIsWellFormed,
  overrideTargetIsWellFormed,
  namedInGraph,
  NO_PERMISSIONS,
  resolvePermissionFold,
} from "./permission.js";

const AVA = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva";
const BOB = "did:syr:z6MkBobBobBobBobBobBobBobBobBobBob";
const CAI = "did:syr:z6MkCaiCaiCaiCaiCaiCaiCaiCaiCaiCai";
const GRAPH = `${AVA}/01JSPREAD00000000000000000` as const;
const NOTE = `${AVA}/01JSPREAD00000000000000001` as const;
const OTHER = `${AVA}/01JSPREAD00000000000000002` as const;
const EVERYONE = `${AVA}/01JSPREAD0000000000000000A` as const;
const EDITORS = `${AVA}/01JSPREAD0000000000000000B` as const;

function role(
  over: Omit<RoleFacts, "position"> & { position?: number },
): RoleFacts {
  return { position: 0, ...over };
}

function fold(roles: RoleFacts[], overrides: OverrideFacts[], writer: string) {
  return resolvePermissionFold({
    writer,
    graph: GRAPH,
    roles,
    overrides,
    member: true,
  });
}

describe("a permission mask", () => {
  it("reads absent as no permissions at all", () => {
    expect(maskBits(undefined)).toBe(0n);
    expect(maskBits("0")).toBe(0n);
  });

  it("round-trips the bits it was written from", () => {
    const bits = Permissions.WRITE_NOTES | Permissions.PUBLISH;
    expect(maskBits(maskOf(bits))).toBe(bits);
  });

  it("carries every verb an administrator has", () => {
    expect(hasPermission(Permissions.ADMINISTRATOR, Permissions.PUBLISH)).toBe(
      true,
    );
    expect(hasPermission(Permissions.PUBLISH, Permissions.WRITE_NOTES)).toBe(
      false,
    );
  });

  it("gives every verb one bit, and gives no two verbs the same bit", () => {
    const bits = Object.values(Permissions);
    expect(new Set(bits).size).toBe(bits.length);
    for (const bit of bits) expect(bit & (bit - 1n)).toBe(0n);
    expect(ALL_PERMISSIONS).toBe(bits.reduce((all, bit) => all | bit, 0n));
  });
});

describe("a graph nobody has written a policy on", () => {
  it("is what an empty set of roles and overrides says", () => {
    expect(hasPolicy([], [])).toBe(false);
    expect(hasPolicy([role({ ref: EVERYONE, everyone: true })], [])).toBe(true);
    expect(
      hasPolicy(
        [],
        [{ scope: GRAPH, target: "principal", target_id: BOB, allow: "1" }],
      ),
    ).toBe(true);
  });

  it("grants what a caller skipping the fold hands writeDecision instead", () => {
    const answer = fold([], [], BOB);
    expect(answer.graphPermissions).toBe(DEFAULT_PERMISSIONS);
    expect(answer.forNote(NOTE)).toBe(DEFAULT_PERMISSIONS);
    expect(answer.hasNoteOverrides).toBe(false);
  });

  it("grants every verb a note's own gate governs, and none that are the graph's", () => {
    const theGraph = [
      Permissions.PUBLISH,
      Permissions.MANAGE_ROLES,
      Permissions.MANAGE_GRAPH,
      Permissions.ADMINISTRATOR,
    ];
    for (const verb of Object.values(Permissions)) {
      expect(hasPermission(DEFAULT_PERMISSIONS, verb)).toBe(
        !theGraph.includes(verb),
      );
    }
  });

  it("is left where it was by a first override written on somebody else", () => {
    const first: OverrideFacts = {
      scope: NOTE,
      target: "principal",
      target_id: CAI,
      deny: maskOf(Permissions.WRITE_NOTES),
    };
    expect(hasPolicy([], [first])).toBe(true);
    expect(fold([], [first], BOB).forNote(NOTE)).toBe(DEFAULT_PERMISSIONS);
    expect(fold([], [first], CAI).forNote(NOTE)).toBe(
      DEFAULT_PERMISSIONS & ~Permissions.WRITE_NOTES,
    );
  });
});

describe("somebody the graph is not kept for", () => {
  it("holds nothing at all, on a graph nobody has written a policy on", () => {
    const answer = resolvePermissionFold({
      writer: BOB,
      graph: GRAPH,
      roles: [],
      overrides: [],
      member: false,
    });

    expect(answer.graphPermissions).toBe(NO_PERMISSIONS);
    expect(hasPermission(answer.graphPermissions, Permissions.READ_NOTES)).toBe(
      false,
    );
    expect(
      hasPermission(answer.graphPermissions, Permissions.WRITE_NOTES),
    ).toBe(false);
    expect(hasPermission(answer.graphPermissions, Permissions.CO_AUTHOR)).toBe(
      false,
    );
  });

  it("is not let in by the role everybody holds", () => {
    const everyone = role({ ref: EVERYONE, everyone: true });
    const answer = resolvePermissionFold({
      writer: BOB,
      graph: GRAPH,
      roles: [everyone],
      overrides: [],
      member: false,
    });

    expect(answer.graphPermissions).toBe(NO_PERMISSIONS);
    expect(answer.forNote(NOTE)).toBe(NO_PERMISSIONS);
  });

  it("is still nothing where an override was written on them", () => {
    const answer = resolvePermissionFold({
      writer: BOB,
      graph: GRAPH,
      roles: [],
      overrides: [
        {
          scope: GRAPH,
          target: "principal",
          target_id: BOB,
          allow: maskOf(ALL_PERMISSIONS),
        },
      ],
      member: false,
    });

    expect(answer.graphPermissions).toBe(NO_PERMISSIONS);
  });

  it("does not shut the graph's own owner out", () => {
    const answer = resolvePermissionFold({
      writer: AVA,
      graph: GRAPH,
      roles: [],
      overrides: [],
      member: false,
    });

    expect(answer.graphPermissions).toBe(ALL_PERMISSIONS);
  });
});

describe("whether a graph served to several people is kept for somebody", () => {
  it("is kept for its own owner, with no role written at all", () => {
    expect(namedInGraph(AVA, GRAPH, [])).toBe(true);
  });

  it("is kept for anybody a role lists", () => {
    const editors = role({ ref: EDITORS, members: [BOB] });
    expect(namedInGraph(BOB, GRAPH, [editors])).toBe(true);
    expect(namedInGraph(CAI, GRAPH, [editors])).toBe(false);
  });

  it("is not kept for a stranger by the role everybody holds", () => {
    const everyone = role({ ref: EVERYONE, everyone: true });
    expect(namedInGraph(BOB, GRAPH, [everyone])).toBe(false);
  });
});

describe("the cascade", () => {
  it("gives the graph's own owner every verb, whatever is written on it", () => {
    const denied = fold(
      [role({ ref: EVERYONE, everyone: true, deny: maskOf(ALL_PERMISSIONS) })],
      [
        {
          scope: GRAPH,
          target: "principal",
          target_id: AVA,
          deny: maskOf(ALL_PERMISSIONS),
        },
      ],
      AVA,
    );
    expect(denied.graphPermissions).toBe(ALL_PERMISSIONS);
    expect(denied.forNote(NOTE)).toBe(ALL_PERMISSIONS);
  });

  it("gives an identity nobody named only what everybody holds", () => {
    const roles = [
      role({
        ref: EVERYONE,
        everyone: true,
        deny: maskOf(Permissions.WRITE_NOTES),
      }),
      role({
        ref: EDITORS,
        position: 1,
        members: [CAI],
        allow: maskOf(Permissions.WRITE_NOTES | Permissions.PUBLISH),
      }),
    ];
    expect(fold(roles, [], BOB).graphPermissions).toBe(
      DEFAULT_PERMISSIONS & ~Permissions.WRITE_NOTES,
    );
    expect(fold(roles, [], CAI).graphPermissions).toBe(
      DEFAULT_PERMISSIONS | Permissions.PUBLISH,
    );
  });

  it("folds roles lowest position first, so a higher one wins per bit", () => {
    const low = role({
      ref: EVERYONE,
      position: 0,
      everyone: true,
      allow: maskOf(Permissions.PUBLISH),
    });
    const high = role({
      ref: EDITORS,
      position: 5,
      members: [BOB],
      deny: maskOf(Permissions.PUBLISH),
    });
    // Handed in the wrong order on purpose: the position orders them, not the
    // array.
    expect(fold([high, low], [], BOB).graphPermissions).toBe(
      DEFAULT_PERMISSIONS,
    );
  });

  it("lets a graph-scoped override on one identity move what their roles said", () => {
    const roles = [
      role({
        ref: EVERYONE,
        everyone: true,
        deny: maskOf(Permissions.WRITE_NOTES),
      }),
    ];
    const answer = fold(
      roles,
      [
        {
          scope: GRAPH,
          target: "principal",
          target_id: BOB,
          allow: maskOf(Permissions.WRITE_NOTES),
          deny: maskOf(Permissions.READ_NOTES),
        },
      ],
      BOB,
    );
    expect(answer.graphPermissions).toBe(
      (DEFAULT_PERMISSIONS & ~Permissions.READ_NOTES) | Permissions.WRITE_NOTES,
    );
  });

  it("reads a graph-scoped role override as nothing: a role says that in layer one", () => {
    const roles = [role({ ref: EVERYONE, everyone: true })];
    const answer = fold(
      roles,
      [
        {
          scope: GRAPH,
          target: "role",
          target_id: EVERYONE,
          allow: maskOf(Permissions.ADMINISTRATOR),
        },
      ],
      BOB,
    );
    expect(answer.graphPermissions).toBe(DEFAULT_PERMISSIONS);
  });

  it("lets an override on a note move the answer for that note alone", () => {
    const roles = [role({ ref: EVERYONE, everyone: true })];
    const answer = fold(
      roles,
      [
        {
          scope: NOTE,
          target: "role",
          target_id: EVERYONE,
          deny: maskOf(Permissions.WRITE_NOTES),
        },
      ],
      BOB,
    );
    expect(answer.hasNoteOverrides).toBe(true);
    expect(answer.forNote(NOTE)).toBe(
      DEFAULT_PERMISSIONS & ~Permissions.WRITE_NOTES,
    );
    expect(answer.forNote(OTHER)).toBe(DEFAULT_PERMISSIONS);
  });

  it("lets an override on one identity beat an override on their role", () => {
    const roles = [role({ ref: EVERYONE, everyone: true })];
    const answer = fold(
      roles,
      [
        {
          scope: NOTE,
          target: "role",
          target_id: EVERYONE,
          deny: maskOf(Permissions.WRITE_NOTES),
        },
        {
          scope: NOTE,
          target: "principal",
          target_id: BOB,
          allow: maskOf(Permissions.WRITE_NOTES),
        },
      ],
      BOB,
    );
    expect(answer.forNote(NOTE)).toBe(DEFAULT_PERMISSIONS);
  });

  it("folds note overrides on roles in ascending role position", () => {
    const roles = [
      role({ ref: EVERYONE, position: 0, everyone: true }),
      role({ ref: EDITORS, position: 9, members: [BOB] }),
    ];
    const answer = fold(
      roles,
      [
        {
          scope: NOTE,
          target: "role",
          target_id: EDITORS,
          allow: maskOf(Permissions.WRITE_NOTES),
        },
        {
          scope: NOTE,
          target: "role",
          target_id: EVERYONE,
          deny: maskOf(Permissions.WRITE_NOTES),
        },
      ],
      BOB,
    );
    expect(answer.forNote(NOTE)).toBe(DEFAULT_PERMISSIONS);
  });

  it("reads an override on a role nobody here holds as nothing", () => {
    const roles = [role({ ref: EVERYONE, everyone: true })];
    const answer = fold(
      roles,
      [
        {
          scope: NOTE,
          target: "role",
          target_id: EDITORS,
          allow: maskOf(Permissions.ADMINISTRATOR),
        },
      ],
      BOB,
    );
    expect(answer.forNote(NOTE)).toBe(DEFAULT_PERMISSIONS);
    expect(answer.hasNoteOverrides).toBe(false);
  });

  it("stops at an administrator, so no override on a note can take a verb off them", () => {
    const roles = [
      role({
        ref: EDITORS,
        members: [BOB],
        allow: maskOf(Permissions.ADMINISTRATOR),
      }),
    ];
    const answer = fold(
      roles,
      [
        {
          scope: NOTE,
          target: "principal",
          target_id: BOB,
          deny: maskOf(ALL_PERMISSIONS),
        },
      ],
      BOB,
    );
    expect(answer.hasNoteOverrides).toBe(false);
    expect(hasPermission(answer.forNote(NOTE), Permissions.PUBLISH)).toBe(true);
  });

  it("answers the same for every note where nothing is written on one", () => {
    const answer = constantPermissionFold(Permissions.READ_NOTES);
    expect(answer.hasNoteOverrides).toBe(false);
    expect(answer.forNote(NOTE)).toBe(Permissions.READ_NOTES);
  });
});

describe("what an override is written against", () => {
  it("is a role's reference, or an identity's DID, and never the other", () => {
    expect(overrideTargetIsWellFormed("role", EDITORS)).toBe(true);
    expect(overrideTargetIsWellFormed("role", BOB)).toBe(false);
    expect(overrideTargetIsWellFormed("principal", BOB)).toBe(true);
    expect(overrideTargetIsWellFormed("principal", EDITORS)).toBe(false);
  });

  it("is a note, where it is written on a role: a role says the graph in its own columns", () => {
    expect(overrideIsWellFormed({ target: "role", target_id: EDITORS })).toBe(
      false,
    );
    expect(
      overrideIsWellFormed({ note: NOTE, target: "role", target_id: EDITORS }),
    ).toBe(true);
    expect(overrideIsWellFormed({ target: "principal", target_id: BOB })).toBe(true);
    expect(
      overrideIsWellFormed({ note: NOTE, target: "principal", target_id: EDITORS }),
    ).toBe(false);
  });
});
