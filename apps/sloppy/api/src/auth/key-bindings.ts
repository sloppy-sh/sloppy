// Which keys speak for a principal, on this instance.
// docs/ARCHITECTURE.md § "Which key speaks for a principal".

import { syrKeyBinding } from "@sloppy/idp";
import type { KeyBinding } from "@sloppy/types";

/**
 * Every {@link KeyBinding} this instance holds. A caller reaches the one it
 * wants through `bindingFor`, so a scheme is a value in this list rather than a
 * branch anywhere — AI.md § "Provider-Agnostic Data Shapes".
 */
export const KEY_BINDINGS = Symbol("key bindings");

export const keyBindings: readonly KeyBinding[] = [syrKeyBinding];
