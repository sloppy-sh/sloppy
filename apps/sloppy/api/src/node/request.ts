// The HTTP edge shared by the domain routes: a request becomes a shape
// `@sloppy/types` already defines, or it is refused in words.

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  type DidSyr,
  DidSyrSchema,
  type OwnedRef,
  OwnedRefSchema,
  type Principal,
  splitOwnedRef,
} from "@sloppy/types";
import type { z } from "zod";
import type { AuthedRequest } from "../auth/authed-request";
import type { Delegation } from "../syr/syr.service";

/**
 * Who is calling, named the way a graph names anybody. It is compared and
 * written to `created_by`; nothing may resolve it — a route that has to reach
 * their identity store takes {@link viewerDelegation}, which is a syr sign-in.
 *
 * `AuthGuard` has already refused a request without one, so the refusal here is
 * for the optional field rather than a second check.
 */
export function viewerDid(request: AuthedRequest): Principal {
  const did = request.viewer?.did;
  if (!did) throw new UnauthorizedException("Sign in to continue.");
  return did;
}

/**
 * What a route needs to act on the person's identity store as them. Held apart
 * from {@link viewerDid} because it carries the delegated token: a route that
 * only names the caller must not be handed a credential it could echo.
 *
 * A viewer who signed in by signing with a key of their own has no identity
 * store, and refusing them is not refusing their credential — a 401 is what a
 * client reads as a session that has died, and it would sign somebody out of
 * one that is perfectly good.
 */
export function viewerDelegation(request: AuthedRequest): Delegation {
  const delegation = request.delegation;
  if (delegation) return delegation;
  if (request.viewer) {
    throw new ForbiddenException(
      "That isn't available yet when you sign in with your own key.",
    );
  }
  throw new UnauthorizedException("Sign in to continue.");
}

export function parseBody<S extends z.ZodType>(
  schema: S,
  body: unknown,
): z.output<S> {
  const parsed = schema.safeParse(body ?? {});
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const field = fieldName(issue.path);
  throw new BadRequestException(
    field ? `${field} — ${issue.message}` : issue.message,
  );
}

/**
 * The field a refusal is about, named the way it is labelled on screen, or
 * `null` where the refusal is about the whole body.
 *
 * Zod's path is a wire path: nobody can act on the `0` in `tags.0`, and a
 * nested one names its container before the field that is actually wrong. But
 * a refusal that names no field at all leaves somebody hunting a form for the
 * one line to change, so the innermost named step goes back in, in words.
 */
function fieldName(path: readonly PropertyKey[]): string | null {
  const named = path.filter((step) => typeof step === "string");
  const words = (named.at(-1) ?? "").replaceAll("_", " ").trim();
  return words === "" ? null : words[0].toUpperCase() + words.slice(1);
}

/**
 * A PATCH body, narrowed to the fields the caller actually sent.
 *
 * An absent field on a PATCH means "leave this alone", and a schema whose
 * fields carry defaults answers `undefined` with the default instead — so
 * without this an omitted list arrives as an empty one and the route erases
 * what it was asked not to touch.
 */
export function parsePatch<S extends z.ZodType>(
  schema: S,
  body: unknown,
): Partial<z.output<S>> {
  const parsed = parseBody(schema, body) as Record<string, unknown>;
  const sent =
    body !== null && typeof body === "object" ? Object.keys(body) : [];
  return Object.fromEntries(
    sent
      .filter((field) => field in parsed)
      .map((field) => [field, parsed[field]]),
  ) as Partial<z.output<S>>;
}

/** An identity named in a path. A person never types one — it arrives from a
 *  link — so a malformed one is a page that is not there. */
export function didOrRefuse(raw: string): DidSyr {
  const parsed = DidSyrSchema.safeParse(decodeURIComponent(raw));
  if (!parsed.success) throw new NotFoundException("That person is not here.");
  return parsed.data;
}

/** `null` rather than a refusal, for a route where "gone" is an answer. */
export function refOrNull(did: string, localId: string): OwnedRef | null {
  const parsed = OwnedRefSchema.safeParse(`${did}/${localId}`);
  return parsed.success ? parsed.data : null;
}

export function requireRef(did: string, localId: string): OwnedRef {
  const ref = refOrNull(did, localId);
  if (!ref) throw new NotFoundException("That note is not here.");
  return ref;
}

export function requireAmendmentRef(did: string, localId: string): OwnedRef {
  const ref = refOrNull(did, localId);
  if (!ref) throw new NotFoundException("That offered change is not here.");
  return ref;
}

export function requireGraphRef(did: string, localId: string): OwnedRef {
  const ref = refOrNull(did, localId);
  if (!ref) throw new NotFoundException("That graph is not here.");
  return ref;
}

/**
 * Which of the caller's graphs a read is about, or absent where they named
 * none — which the service reads as the graph they started with, the way an
 * address with no graph beside it means the one they are looking at.
 */
export function graphOrRefuse(
  raw: string | undefined,
  did: Principal,
): OwnedRef | undefined {
  if (!raw) return undefined;
  const parsed = OwnedRefSchema.safeParse(raw);
  if (!parsed.success || splitOwnedRef(parsed.data).owner !== did) {
    throw new NotFoundException("That graph is not here.");
  }
  return parsed.data;
}

/** How many levels of a tree to read. Absent reads all of it. */
export function depthBound(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const levels = Number(raw);
  if (!Number.isSafeInteger(levels) || levels < 1) {
    throw new BadRequestException("Ask for at least one level.");
  }
  return levels;
}

export function ownedRefOrRefuse(
  raw: string | undefined,
): OwnedRef | undefined {
  if (!raw) return undefined;
  const parsed = OwnedRefSchema.safeParse(raw);
  if (!parsed.success) throw new NotFoundException("That tree is not here.");
  return parsed.data;
}
