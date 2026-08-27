// The HTTP edge shared by the domain routes: a request becomes a shape
// `@sloppy/types` already defines, or it is refused in words.

import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { type DidSyr, type OwnedRef, OwnedRefSchema } from "@sloppy/types";
import type { z } from "zod";
import type { AuthedRequest } from "../auth/authed-request";
import type { Delegation } from "../syr/syr.service";

/** `AuthGuard` has already refused a request without one; this is the type
 *  narrowing, not a second check. */
export function viewerDid(request: AuthedRequest): DidSyr {
  const did = request.viewer?.did;
  if (!did) throw new UnauthorizedException("Sign in to continue.");
  return did;
}

/**
 * What a route needs to act on the person's identity store as them. Held apart
 * from {@link viewerDid} because it carries the delegated token: a route that
 * only names the caller must not be handed a credential it could echo.
 */
export function viewerDelegation(request: AuthedRequest): Delegation {
  const delegation = request.delegation;
  if (!delegation) throw new UnauthorizedException("Sign in to continue.");
  return delegation;
}

export function parseBody<S extends z.ZodType>(
  schema: S,
  body: unknown,
): z.output<S> {
  const parsed = schema.safeParse(body ?? {});
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const field = issue.path.join(".");
  throw new BadRequestException(
    field ? `${field}: ${issue.message}` : issue.message,
  );
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
