import type { ExecutionContext } from "@nestjs/common";
import {
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { DidSyrSchema } from "@sloppy/types";
import { RecordId } from "surrealdb";
import { describe, expect, it, vi } from "vitest";
import type { AuthService } from "./auth.service";
import { AuthGuard } from "./auth.guard";
import type { AuthedRequest } from "./authed-request";
import type { SessionRow } from "./session.store";

const DID = DidSyrSchema.parse("did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva");

const SESSION: SessionRow = {
  id: new RecordId("session", "digest"),
  created_by: DID,
  syr_instance_url: "https://syr.is",
  delegate_public_key: "z6MkDelegate",
  access_token: "the-delegated-token",
  expires_at: "2099-01-01T00:00:00.000Z",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

function guard(isPublic: boolean, session: SessionRow | null) {
  const resolve = vi.fn().mockResolvedValue(session);
  const reflector = {
    getAllAndOverride: () => isPublic,
  } as unknown as Reflector;
  const auth = { resolve } as unknown as AuthService;
  return { guard: new AuthGuard(reflector, auth), resolve };
}

/** The session store refusing to answer, as a query against a connection that
 *  has lost its authorization does. */
function storeDown(isPublic: boolean) {
  const resolve = vi
    .fn()
    .mockRejectedValue(new Error("Anonymous access not allowed"));
  const reflector = {
    getAllAndOverride: () => isPublic,
  } as unknown as Reflector;
  return new AuthGuard(reflector, { resolve } as unknown as AuthService);
}

function context(headers: Record<string, string>): {
  context: ExecutionContext;
  request: AuthedRequest;
} {
  const request = { headers } as unknown as AuthedRequest;
  return {
    request,
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => () => undefined,
      getClass: () => class {},
    } as unknown as ExecutionContext,
  };
}

describe("the guard every route runs behind", () => {
  it("lets a public route through with nobody signed in", async () => {
    const { guard: subject, resolve } = guard(true, null);
    const { context: ctx, request } = context({});

    await expect(subject.canActivate(ctx)).resolves.toBe(true);
    expect(request.viewer).toBeUndefined();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("refuses everything else with nobody signed in", async () => {
    const { guard: subject } = guard(false, null);
    const { context: ctx } = context({});

    await expect(subject.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("refuses a credential the session store does not know", async () => {
    const { guard: subject, resolve } = guard(false, null);
    const { context: ctx } = context({ authorization: "Bearer gone" });

    await expect(subject.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(resolve).toHaveBeenCalledWith("gone");
  });

  it("attaches the viewer and the delegation behind it", async () => {
    const { guard: subject } = guard(false, SESSION);
    const { context: ctx, request } = context({ authorization: "Bearer good" });

    await expect(subject.canActivate(ctx)).resolves.toBe(true);
    expect(request.viewer).toEqual({
      did: DID,
      syr_instance_url: "https://syr.is",
      delegate_public_key: "z6MkDelegate",
    });
    expect(request.delegation?.access_token).toBe("the-delegated-token");
  });

  it("keeps the token out of the half a client is told", async () => {
    const { guard: subject } = guard(false, SESSION);
    const { context: ctx, request } = context({ authorization: "Bearer good" });
    await subject.canActivate(ctx);

    expect(Object.values(request.viewer ?? {})).not.toContain(
      "the-delegated-token",
    );
  });

  // A cookie nobody can decode is one somebody is stuck with, and the route
  // that clears it is behind this guard.
  it("treats a cookie it cannot read as nobody, not as a failure", async () => {
    const { guard: publicRoute, resolve } = guard(true, SESSION);
    const { context: ctx, request } = context({ cookie: "sloppy_session=%zz" });

    await expect(publicRoute.canActivate(ctx)).resolves.toBe(true);
    expect(request.viewer).toBeUndefined();
    expect(resolve).not.toHaveBeenCalled();

    const { guard: protectedRoute } = guard(false, SESSION);
    await expect(
      protectedRoute.canActivate(
        context({ cookie: "sloppy_session=%zz" }).context,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("still looks for a session on a public route, so `me` can answer", async () => {
    const { guard: subject } = guard(true, SESSION);
    const { context: ctx, request } = context({ authorization: "Bearer good" });

    await expect(subject.canActivate(ctx)).resolves.toBe(true);
    expect(request.viewer?.did).toBe(DID);
  });
});

describe("a session store that cannot answer", () => {
  it("lets a public route run, so the way back in still works", async () => {
    const { context: ctx, request } = context({ authorization: "Bearer good" });

    await expect(storeDown(true).canActivate(ctx)).resolves.toBe(true);
    expect(request.viewer).toBeUndefined();
    expect(request.sessionUnverified).toBe(true);
  });

  // 401 is the client's cue to drop the session app-wide, and a store having a
  // bad afternoon is not somebody's session ending.
  it("refuses a protected route as unavailable rather than unauthorized", async () => {
    const { context: ctx } = context({ authorization: "Bearer good" });

    await expect(storeDown(false).canActivate(ctx)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("still refuses a protected route reached with no credential at all", async () => {
    const { context: ctx, request } = context({});

    await expect(storeDown(false).canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(request.sessionUnverified).toBeUndefined();
  });
});
