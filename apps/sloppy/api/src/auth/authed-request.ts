import type { Viewer } from "@sloppy/types";
import type { Request } from "express";
import type { Delegation } from "../syr/syr.service";

/**
 * What `AuthGuard` attaches once a session checks out, so a controller can type
 * `@Req()` instead of falling back to `any`. Absent on a `@Public()` route
 * reached without a session, which runs anonymously.
 *
 * `viewer` is the half a client may be told. `delegation` carries the token the
 * person's instance signs with, for a route that has to ask it to — it is a
 * credential, so it belongs in a request to syr and in no response body.
 */
export type AuthedRequest = Request & {
  viewer?: Viewer;
  delegation?: Delegation;
};
