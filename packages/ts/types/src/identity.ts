// Where an identity a device writes under came from —
// docs/ARCHITECTURE.md § "A graph off the device".

import { z } from "zod";

/**
 * How a device reaches the key behind an identity: `device` is one whose key is
 * in a file here, `delegated` one an identity store somewhere else holds and
 * signs for.
 *
 * The axis is where the key is, never which product keeps it, so a second kind
 * of store is a VALUE here and never a field beside one — AI.md
 * § "Provider-Agnostic Data Shapes".
 */
export const IdentitySourceSchema = z.enum(["device", "delegated"]);
export type IdentitySource = z.infer<typeof IdentitySourceSchema>;
