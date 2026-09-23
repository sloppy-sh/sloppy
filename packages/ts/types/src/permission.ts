// What a graph lets somebody do in it, and how one answer is folded out of the
// roles and the overrides written on it — docs/ARCHITECTURE.md § "Who may write
// where".

import { splitOwnedRef } from "./codecs.js";
import {
  OwnedEntitySchema,
  type OwnedRef,
  OwnedRefSchema,
  type Principal,
  PrincipalSchema,
} from "./common.js";
import { z } from "zod";

/**
 * Sloppy's verbs, one bit each.
 *
 * **A bit's position is written once and never moved.** A role stores the
 * number these make, so renumbering one would silently re-grant every role
 * already written — and no read anywhere would fail.
 */
export const Permissions = {
  READ_NOTES: 1n << 0n,
  WRITE_NOTES: 1n << 1n,
  CREATE_NOTES: 1n << 2n,
  DELETE_NOTES: 1n << 3n,
  /**
   * Move a note and write its address. An offer carries a note's writing and
   * never its place — docs/ARCHITECTURE.md § "Whose writing a note carries" —
   * so this is a verb of its own and never implied by `WRITE_NOTES`.
   */
  PLACE_NOTES: 1n << 4n,
  OFFER_CHANGE: 1n << 5n,
  /** Take an offer in, or turn it down. The note's own gate still decides whose
   *  offers these are: taking one in is the owner's act. */
  TAKE_OFFER: 1n << 6n,
  PUBLISH: 1n << 7n,
  /**
   * Write into a note somebody else has already written into, and so join its
   * `authors`. Without it a write that would append the writer to that list
   * does not land and is offered instead, which is what keeps `authors` the
   * whole truth about whose writing a note carries.
   */
  CO_AUTHOR: 1n << 8n,
  MANAGE_ROLES: 1n << 9n,
  /** Rename the graph and say what it takes writing from. */
  MANAGE_GRAPH: 1n << 10n,
  /** Every verb above, and every verb added after it. */
  ADMINISTRATOR: 1n << 11n,
} as const;

export type Permission = (typeof Permissions)[keyof typeof Permissions];

export const ALL_PERMISSIONS: bigint = Object.values(Permissions).reduce(
  (all, bit) => all | bit,
  0n,
);

/** What somebody the graph is not kept for holds: nothing, reading included. */
export const NO_PERMISSIONS = 0n;

/**
 * What a graph grants somebody it IS kept for, before any role of its own
 * narrows it. It is the verbs a note's own gate already governs, placing among
 * them, and none of the ones that are the graph's alone: publishing, and saying
 * who may do what in it.
 *
 * **The floor the cascade folds from**, which is what keeps writing a first
 * role or a first override from taking a verb off everybody already there. A
 * graph closes one off by denying it on the role everybody holds.
 */
export const DEFAULT_PERMISSIONS: bigint =
  Permissions.READ_NOTES |
  Permissions.WRITE_NOTES |
  Permissions.CREATE_NOTES |
  Permissions.DELETE_NOTES |
  Permissions.PLACE_NOTES |
  Permissions.OFFER_CHANGE |
  Permissions.TAKE_OFFER |
  Permissions.CO_AUTHOR;

/** Whether these permissions carry a verb. `ADMINISTRATOR` carries all of them. */
export function hasPermission(permissions: bigint, flag: bigint): boolean {
  if (permissions & Permissions.ADMINISTRATOR) return true;
  return (permissions & flag) === flag;
}

/**
 * A set of permissions as a row holds one: the bits as a decimal integer in a
 * string, because no store here has a 64-bit-wide number that survives a round
 * trip.
 */
export const PermissionMaskSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/, "Expected a permission mask")
  .max(40);
export type PermissionMask = z.infer<typeof PermissionMaskSchema>;

/** The bits a stored mask holds. **Absent is none of them.** */
export function maskBits(mask: PermissionMask | undefined): bigint {
  return mask === undefined ? 0n : BigInt(mask);
}

export function maskOf(bits: bigint): PermissionMask {
  return bits.toString();
}

/**
 * A role in one graph: a set of permissions, and who holds it.
 *
 * `created_by` is the graph's owner, as it is on every row in their graph.
 */
export const GraphRoleSchema = OwnedEntitySchema.extend({
  graph: OwnedRefSchema,
  title: z.string().min(1).max(512),
  /** Folded lowest first, so a higher role's allow and deny win. Two roles at
   *  one position fold in the order they were written. */
  position: z.int(),
  /**
   * The role everybody writing in this graph holds, whether or not they are
   * named anywhere. **Absent is a role given out one identity at a time, and
   * `false` is never written** — one role per graph carries this, and the
   * UNIQUE index that holds that rule does not constrain a row whose column is
   * absent.
   */
  everyone: z.literal(true).optional(),
  /** Who holds it. Absent, and empty, are nobody. */
  members: z.array(PrincipalSchema).optional(),
  allow: PermissionMaskSchema.default("0"),
  deny: PermissionMaskSchema.default("0"),
});
export type GraphRole = z.infer<typeof GraphRoleSchema>;

/** What an override is written against: a role in the graph, or one identity. */
export const OverrideTargetSchema = z.enum(["role", "principal"]);
export type OverrideTarget = z.infer<typeof OverrideTargetSchema>;

/**
 * An allow and a deny written on one scope for one target, folded over whatever
 * the roles already said.
 *
 * Every column but the two masks is immutable, this row being that pairing: a
 * changed half is a different override and a new row, which is also what makes
 * the UNIQUE index the one-override-per-target rule.
 */
export const PermissionOverrideSchema = OwnedEntitySchema.extend({
  graph: OwnedRefSchema,
  /**
   * What it attaches to: a note's ref, or the graph's own ref where it applies
   * across the graph. Written out rather than left absent for the graph,
   * because a UNIQUE index does not constrain a row whose indexed column is
   * absent — and the rule here is one override per target per scope.
   */
  scope: OwnedRefSchema,
  target: OverrideTargetSchema,
  /** The role's ref where `target` is `role`, and the identifier itself where
   *  it is `principal`. Flat beside the discriminant, so an index can read it. */
  target_id: z.string().min(1).max(256),
  allow: PermissionMaskSchema.default("0"),
  deny: PermissionMaskSchema.default("0"),
});
export type PermissionOverride = z.infer<typeof PermissionOverrideSchema>;

/** What the cascade reads off a role, whether it holds a row or a view of one. */
export interface RoleFacts {
  readonly ref: OwnedRef;
  readonly position: number;
  readonly everyone?: boolean;
  readonly members?: readonly Principal[];
  readonly allow?: PermissionMask;
  readonly deny?: PermissionMask;
}

/** What the cascade reads off an override. */
export interface OverrideFacts {
  readonly scope: OwnedRef;
  readonly target: OverrideTarget;
  readonly target_id: string;
  readonly allow?: PermissionMask;
  readonly deny?: PermissionMask;
}

export interface PermissionFoldInput {
  readonly writer: Principal;
  /** The graph being folded. Its owner half holds every verb in it — a first
   *  role written on a graph must not lock its own author out. */
  readonly graph: OwnedRef;
  /** Every role written on that graph, unfiltered and unsorted. */
  readonly roles: readonly RoleFacts[];
  /** Every override written on that graph, unfiltered. */
  readonly overrides: readonly OverrideFacts[];
  /**
   * Whether this graph is kept for this identity at all. It is a fact about the
   * surface asking, not a rule the cascade owns, and the two surfaces answer it
   * differently on purpose:
   *
   * - A graph served to several people names them. Its owner, or somebody a
   *   role lists, is one; anybody else is not, whatever a role everybody holds
   *   says. {@link namedInGraph} is that answer.
   * - A graph somebody holds on their own device answers `true` for whoever
   *   holds it. There is nobody to arbitrate between, and what they write is
   *   taken up elsewhere by people accepting it rather than gated here.
   *
   * False folds to {@link NO_PERMISSIONS} before any layer runs, so a graph
   * that has never had a role written on it is closed rather than open.
   */
  readonly member: boolean;
}

export interface PermissionFold {
  /** The answer with no note in scope. */
  readonly graphPermissions: bigint;
  /** False where no note-scoped override can move the answer, so a caller can
   *  answer for every note at once. */
  readonly hasNoteOverrides: boolean;
  forNote(note: OwnedRef): bigint;
}

/**
 * Whether a graph has any policy written on it at all — what a caller asks to
 * skip a fold, never to reach a second answer: a graph with none folds to
 * {@link DEFAULT_PERMISSIONS} for somebody it is kept for, and to
 * {@link NO_PERMISSIONS} for anybody else.
 */
export function hasPolicy(
  roles: readonly RoleFacts[],
  overrides: readonly OverrideFacts[],
): boolean {
  return roles.length > 0 || overrides.length > 0;
}

/**
 * Whether a graph served to several people is kept for this identity: it owns
 * the graph, or a role written on it names it.
 *
 * The role everybody holds does NOT make somebody one of them. "Everybody"
 * there is everybody the graph is kept for, so that a graph whose policy nobody
 * has written yet is closed to a stranger rather than open to one.
 */
export function namedInGraph(
  writer: Principal,
  graph: OwnedRef,
  roles: readonly RoleFacts[],
): boolean {
  if (splitOwnedRef(graph).owner === writer) return true;
  return roles.some((role) => role.members?.includes(writer) ?? false);
}

/** `perms = (perms & ~deny) | allow` — the one rule every layer applies. */
function applied(
  permissions: bigint,
  allow: PermissionMask | undefined,
  deny: PermissionMask | undefined,
): bigint {
  return (permissions & ~maskBits(deny)) | maskBits(allow);
}

/** A fold no override can move — the graph's owner, and an administrator. */
export function constantPermissionFold(permissions: bigint): PermissionFold {
  return {
    graphPermissions: permissions,
    hasNoteOverrides: false,
    forNote: () => permissions,
  };
}

function heldRoles(
  writer: Principal,
  roles: readonly RoleFacts[],
): readonly RoleFacts[] {
  return roles
    .filter((role) => role.everyone || role.members?.includes(writer))
    .sort((a, b) => a.position - b.position);
}

/** Layer 1 alone: {@link DEFAULT_PERMISSIONS} as the roles this identity holds
 *  leave it. */
function graphPermissionsFor(
  writer: Principal,
  roles: readonly RoleFacts[],
): bigint {
  let permissions = DEFAULT_PERMISSIONS;
  for (const role of heldRoles(writer, roles)) {
    permissions = applied(permissions, role.allow, role.deny);
  }
  return permissions;
}

/**
 * The cascade, folded in memory from {@link DEFAULT_PERMISSIONS}. Layers,
 * lowest to highest:
 *
 *   1. the roles this identity holds, in ascending position
 *   2. the graph-scoped override written on this identity
 *   3. note-scoped role overrides, in ascending role position
 *   4. the note-scoped override written on this identity
 *
 * A graph-scoped ROLE override is not a layer: a role carries its graph-wide
 * allow and deny in layer 1.
 */
export function resolvePermissionFold(
  input: PermissionFoldInput,
): PermissionFold {
  const { writer, graph, roles, overrides } = input;

  if (splitOwnedRef(graph).owner === writer) {
    return constantPermissionFold(ALL_PERMISSIONS);
  }

  if (!input.member) return constantPermissionFold(NO_PERMISSIONS);

  const held = heldRoles(writer, roles);
  const positionOf = new Map(held.map((role) => [role.ref, role.position]));

  const roleNoteOverrides = new Map<string, OverrideFacts[]>();
  const didNoteOverrides = new Map<string, OverrideFacts>();
  let graphOverride: OverrideFacts | undefined;

  for (const override of overrides) {
    if (override.target === "role") {
      if (!positionOf.has(override.target_id)) continue;
      if (override.scope === graph) continue;
      const list = roleNoteOverrides.get(override.scope);
      if (list) list.push(override);
      else roleNoteOverrides.set(override.scope, [override]);
      continue;
    }
    if (override.target_id !== writer) continue;
    // The first row written on a scope wins, here and for a note below.
    if (override.scope === graph) {
      graphOverride ??= override;
      continue;
    }
    if (!didNoteOverrides.has(override.scope)) {
      didNoteOverrides.set(override.scope, override);
    }
  }

  let graphPermissions = graphPermissionsFor(writer, roles);
  if (graphOverride) {
    graphPermissions = applied(
      graphPermissions,
      graphOverride.allow,
      graphOverride.deny,
    );
  }

  if (hasPermission(graphPermissions, Permissions.ADMINISTRATOR)) {
    return constantPermissionFold(graphPermissions);
  }

  // `sort` is stable, so two roles at one position keep the order they arrived.
  const byPosition = (a: OverrideFacts, b: OverrideFacts) =>
    (positionOf.get(a.target_id) ?? 0) - (positionOf.get(b.target_id) ?? 0);
  for (const list of roleNoteOverrides.values()) list.sort(byPosition);

  return {
    graphPermissions,
    hasNoteOverrides: roleNoteOverrides.size > 0 || didNoteOverrides.size > 0,
    forNote(note: OwnedRef): bigint {
      let permissions = graphPermissions;
      for (const override of roleNoteOverrides.get(note) ?? []) {
        permissions = applied(permissions, override.allow, override.deny);
      }
      const own = didNoteOverrides.get(note);
      if (own) permissions = applied(permissions, own.allow, own.deny);
      return permissions;
    },
  };
}

/**
 * Write a role. `position` orders it against the graph's other roles, lowest
 * folded first; `members` is the WHOLE list, never a delta.
 *
 * The role everybody holds is the graph's own and is not written through here.
 */
export const CreateGraphRoleRequestSchema = z.strictObject(
  {
    title: z
      .string()
      .min(1, "Name this role.")
      .max(512, "That name is longer than a role name can be. Trim it."),
    position: z.int().min(0).max(1_000_000),
    members: z.array(PrincipalSchema).max(1000).optional(),
    allow: PermissionMaskSchema.optional(),
    deny: PermissionMaskSchema.optional(),
  },
  { error: "Sloppy is out of date. Update it and try again." },
);
export type CreateGraphRoleRequest = z.input<
  typeof CreateGraphRoleRequestSchema
>;

/** Absent leaves a field as it is; `members`, `allow` and `deny` replace
 *  whatever the role carries whole. */
export const UpdateGraphRoleRequestSchema = z.strictObject(
  {
    title: z
      .string()
      .min(1, "Name this role.")
      .max(512, "That name is longer than a role name can be. Trim it.")
      .optional(),
    position: z.int().min(0).max(1_000_000).optional(),
    members: z.array(PrincipalSchema).max(1000).optional(),
    allow: PermissionMaskSchema.optional(),
    deny: PermissionMaskSchema.optional(),
  },
  { error: "Sloppy is out of date. Update it and try again." },
);
export type UpdateGraphRoleRequest = z.input<
  typeof UpdateGraphRoleRequestSchema
>;

/**
 * Write the allow and deny one target carries on one scope, replacing whatever
 * it carried. **Absent `note` is the graph itself**, which is where an override
 * on an identity says what they may do everywhere in it.
 */
export const SetPermissionOverrideRequestSchema = z.strictObject(
  {
    note: OwnedRefSchema.optional(),
    target: OverrideTargetSchema,
    /** The role's ref, or the identifier itself, as `target` says. */
    target_id: z.string().min(1).max(256),
    allow: PermissionMaskSchema.optional(),
    deny: PermissionMaskSchema.optional(),
  },
  { error: "Sloppy is out of date. Update it and try again." },
);
export type SetPermissionOverrideRequest = z.input<
  typeof SetPermissionOverrideRequestSchema
>;

/**
 * The id as the row stores it: held to the schema its `target` names, which is
 * also what spells it the one way everything else compares. **`undefined` is an
 * id of the wrong shape for the target it names**, and a caller writing the row
 * stores what comes back rather than what it was handed.
 */
export function overrideTargetId(
  target: OverrideTarget,
  targetId: string,
): string | undefined {
  const shape = target === "role" ? OwnedRefSchema : PrincipalSchema;
  const parsed = shape.safeParse(targetId);
  return parsed.success ? parsed.data : undefined;
}

/**
 * What `SetPermissionOverrideRequestSchema` cannot refuse.
 *
 * A role's graph-wide allow and deny are the role's own columns, folded in
 * layer 1, so a graph-scoped override on a role is not a layer: written, it
 * would deny nothing and still give the graph a policy.
 */
export function overrideIsWellFormed(
  override: Pick<SetPermissionOverrideRequest, "note" | "target" | "target_id">,
): boolean {
  if (override.target === "role" && override.note === undefined) return false;
  return overrideTargetId(override.target, override.target_id) !== undefined;
}
