// The text somebody signs to sign in, and the one reader of it.
// docs/ARCHITECTURE.md § "Signing in with a key of your own".

import type { Principal, SignInChallenge } from "@sloppy/types";
import { SignedTokens } from "./signed-token";

const HEADING = "Sloppy sign-in";

/** What one statement binds: whom it is for, and which Sloppy it is for. */
export interface ChallengeClaim {
  readonly principal: Principal;
  readonly origin: string;
}

/** A statement this instance issued, as it reads after the line endings and the
 *  trailing blank lines a person's editor may have added are taken back out. */
export interface ReadChallenge {
  readonly claim: ChallengeClaim;
  readonly statement: string;
  readonly token: string;
}

/**
 * One function writes a statement and one reads it, and the reader rebuilds
 * rather than parses: what a person read above the signature is then exactly
 * what the signature is held to.
 */
function statementOf(claim: ChallengeClaim, token: string): string {
  return [
    HEADING,
    `Signing in as ${claim.principal}`,
    `Signing in to ${claim.origin}`,
    token,
  ].join("\n");
}

export class SignInChallenges {
  private readonly tokens: SignedTokens<ChallengeClaim>;

  constructor(
    secret: string,
    private readonly ttlMs: number,
  ) {
    this.tokens = new SignedTokens(secret, ttlMs);
  }

  issue(claim: ChallengeClaim): SignInChallenge {
    return {
      statement: statementOf(claim, this.tokens.issue(claim)),
      expires_at: new Date(Date.now() + this.ttlMs).toISOString(),
    };
  }

  /** `null` for a statement this instance did not issue, one whose text has
   *  been altered since, and one that has expired. */
  read(presented: string): ReadChallenge | null {
    const statement = presented.replaceAll("\r\n", "\n").replace(/\n+$/, "");
    const lines = statement.split("\n");
    const token = lines.length === 4 ? lines[3] : undefined;
    if (!token) return null;
    const claim = this.tokens.verify(token);
    if (!claim || statementOf(claim, token) !== statement) return null;
    return { claim, statement, token };
  }

  /** Spends a statement, so nothing signs in with it twice. False where it has
   *  already been spent. */
  spend(token: string): boolean {
    return this.tokens.consume(token) !== null;
  }
}
