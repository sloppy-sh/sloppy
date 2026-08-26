import type { Request } from "express";
import type { Viewer } from "@sloppy/types";

/**
 * What `AuthGuard` attaches once a session checks out, so a controller can type
 * `@Req()` instead of falling back to `any`. Absent on a `@Public()` route,
 * which runs with no session at all.
 */
export type AuthedRequest = Request & { viewer?: Viewer };
