// Asking where somebody says their graph is served, in the order a reader asks
// it. docs/ARCHITECTURE.md § "Where a person's graph is" is the doc of record.

import { mailboxOf } from "@sloppy/openpgp";
import type { Domain, Principal, Whereabouts } from "@sloppy/types";

/**
 * Where a declaration is served — at the site root, and at one path whether a
 * domain or an instance is answering, so a reader holds one address and which
 * of the two it reached is the resolver's own business.
 *
 * `main.ts` keeps it out of the `/api` prefix, because a peer resolves it at
 * the site root the way it resolves syr's own documents.
 */
export const WHEREABOUTS_PATH = ".well-known/sloppy-whereabouts";

/** A declaration is three short fields, so an answer running past this is not
 *  one. */
export const MAX_WHEREABOUTS_BYTES = 16 * 1024;

/** A declaration is one small read, not a page of somebody's writing. */
export const WHEREABOUTS_TIMEOUT_MS = 10_000;

export function whereaboutsUrl(origin: string, principal: Principal): string {
  return `${origin}/${WHEREABOUTS_PATH}/${encodeURIComponent(principal)}`;
}

/**
 * What one source said, and what a resolution settles on.
 *
 * - `said` — a declaration of that person's answered.
 * - `none` — something answered, and nothing it said says where they are.
 *   **That is an answer**: being told nobody there says, which is a different
 *   thing from not knowing.
 * - `unreachable` — nothing answered. A refusal is this too, so a domain
 *   somebody else chose can never turn a lookup into a statement about them.
 */
export type WhereaboutsAnswer =
  | { readonly answer: "said"; readonly whereabouts: Whereabouts }
  | { readonly answer: "none" }
  | { readonly answer: "unreachable" };

/** The domain a reader asks first: the one an identifier carries. `undefined`
 *  where it carries none, which is somebody reached through an instance alone
 *  until they name a domain in the declaration served there. */
export function ownDomain(principal: Principal): Domain | undefined {
  return mailboxOf(principal)?.domain;
}

/**
 * Their own domain first, the instance named alongside them second, and the
 * first declaration found is the answer.
 *
 * The instance's answer may name a domain its subject controls, and that domain
 * is then asked ONCE — which is what lets somebody at a mailbox provider be
 * found through a host the first time and through their own domain from then
 * on. A domain's own answer is followed nowhere, so no declaration can send a
 * reader on to a second one and two of them cannot pass a reader back and
 * forth.
 */
export async function whereaboutsFrom(asked: {
  principal: Principal;
  atDomain: (domain: Domain) => Promise<WhereaboutsAnswer>;
  atInstance: () => Promise<WhereaboutsAnswer>;
}): Promise<WhereaboutsAnswer> {
  const own = ownDomain(asked.principal);
  let answered = false;

  if (own !== undefined) {
    const said = await asked.atDomain(own);
    if (said.answer === "said") return said;
    answered = said.answer === "none";
  }

  const served = await asked.atInstance();
  if (served.answer !== "said") {
    return answered || served.answer === "none"
      ? { answer: "none" }
      : { answer: "unreachable" };
  }

  const named = served.whereabouts.domain;
  if (named === undefined || named === own) return served;
  const again = await asked.atDomain(named);
  return again.answer === "said" ? again : served;
}
