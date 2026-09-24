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
 * credential, so it belongs in a request to syr and in no response body. It is
 * absent on a viewer who signed in by signing with a key of their own, who has
 * no identity store behind them, so a route that needs one refuses them the way
 * it refuses anybody without a session.
 */
export type AuthedRequest = Request & {
  viewer?: Viewer;
  delegation?: Delegation;
  /**
   * Set where a credential arrived and the session store could not say whom it
   * names. A route that reads `viewer` alone would call that nobody, and answer
   * a signed-in person as anonymous.
   */
  sessionUnverified?: true;
};

/** What a caller is told when their credential could not be checked. */
export const SESSION_UNVERIFIED =
  "Sloppy could not check who you are just now. Try again in a moment.";
