import { randomBytes } from "node:crypto";
import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Session, StartLoginRequest } from "@sloppy/types";
import {
  AppConfigService,
  localIdpEnabled,
} from "../config/app-config.service";
import type { DelegationState } from "../syr/syr.service";
import { SyrService } from "../syr/syr.service";
import { isAllowedRedirect } from "./redirect-target";
import {
  type SessionRow,
  SessionStore,
  delegationOf,
  viewerOf,
} from "./session.store";
import { SignedTokens } from "./signed-token";

/** How long somebody has to decide on the consent screen. */
const CONSENT_TTL_MS = 10 * 60 * 1000;
/** How long a shell has to pick the callback up and finish. */
const HAND_OFF_TTL_MS = 2 * 60 * 1000;
/**
 * How often a live session is confirmed against the person's instance. The
 * delegated token stays valid until it expires, so this is what turns "they
 * revoked Sloppy" into "signed out", and the interval is the delay they see.
 */
const RECHECK_MS = 5 * 60 * 1000;

/**
 * Sloppy signs notes as the person, keeps their pictures in their own file
 * store and their emoji in their own catalog, and saves the name and pictures
 * they choose — so `posts:write` is asked for up front. syr's scope vocabulary
 * has no finer word for it, and asking for less than Sloppy does would make the
 * consent screen a lie.
 */
const SCOPES = ["identity:read", "profile:read", "posts:write"] as const;

/** Where a person lands when they named nowhere in particular. */
export const HOME = "/";

/** Sealed into the consent redirect and read back at the callback. */
interface ConsentState {
  inst: string;
  redirect?: string;
}

/** Sealed into the hand-off a shell receives when it caught the callback. */
interface HandOffState {
  inst: string;
  delegation_id: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly consent: SignedTokens<ConsentState>;
  private readonly handOff: SignedTokens<HandOffState>;
  private readonly rechecks = new Map<
    string,
    { at: number; state: Promise<DelegationState> }
  >();

  constructor(
    private readonly app: AppConfigService,
    config: ConfigService,
    private readonly syr: SyrService,
    private readonly sessions: SessionStore,
  ) {
    const secret = config.get<string>("SLOPPY_SESSION_SECRET");
    if (!secret) {
      this.logger.warn(
        "SLOPPY_SESSION_SECRET is unset; using a key that lasts as long as this process. A sign-in already in flight will not survive a restart.",
      );
    }
    const key = secret ?? randomBytes(32).toString("hex");
    this.consent = new SignedTokens(key, CONSENT_TTL_MS);
    this.handOff = new SignedTokens(key, HAND_OFF_TTL_MS);
  }

  /**
   * This Sloppy's own provider, for somebody who has no identity anywhere, or
   * `null` where it only delegates. Offering an address a person would
   * otherwise have to be told is the difference between a first run that ends
   * in an account and one that ends at a form.
   */
  ownInstanceUrl(): string | null {
    return localIdpEnabled() ? this.platformOrigin : null;
  }

  /**
   * syr requires `callback_url` to sit on `platform_origin` and matches it
   * byte-for-byte at the token endpoint, so both are derived from one value and
   * the callback carries no query of its own.
   */
  private get platformOrigin(): string {
    return new URL(this.app.publicUrl).origin;
  }

  get callbackUrl(): string {
    return `${this.app.publicUrl.replace(/\/+$/, "")}/api/auth/callback`;
  }

  async consentRedirect(request: StartLoginRequest): Promise<string> {
    const inst = request.instance_url;
    const redirect = isAllowedRedirect(request.redirect)
      ? request.redirect
      : undefined;
    return this.syr.consentUrl(inst, {
      platform_origin: this.platformOrigin,
      platform_name: "Sloppy",
      callback_url: this.callbackUrl,
      scopes: SCOPES,
      state: this.consent.issue({ inst, ...(redirect ? { redirect } : {}) }),
    });
  }

  /** `null` where the state is forged, replayed, or simply too old. */
  readConsentState(state: string): ConsentState | null {
    return this.consent.consume(state);
  }

  /**
   * What a shell that will finish the exchange itself is handed. The
   * authorization code stays syr's to spend, so nothing here grants anything on
   * its own — this only names which delegation the code belongs to.
   */
  issueHandOff(inst: string, delegationId: string): string {
    return this.handOff.issue({ inst, delegation_id: delegationId });
  }

  async signIn(
    inst: string,
    code: string,
    delegationId: string,
  ): Promise<Session> {
    const tokens = await this.syr.exchangeCode(inst, {
      code,
      delegation_id: delegationId,
      callback_url: this.callbackUrl,
      platform_origin: this.platformOrigin,
    });
    const expiresAt = new Date(
      Date.now() + tokens.expires_in * 1000,
    ).toISOString();
    const { credential, row } = await this.sessions.issue({
      did: tokens.did,
      syr_instance_url: inst,
      delegate_public_key: tokens.delegate_public_key,
      access_token: tokens.access_token,
      expires_at: expiresAt,
    });
    this.logger.log(`Signed in ${tokens.did} via ${inst}`);
    return { token: credential, expires_at: expiresAt, viewer: viewerOf(row) };
  }

  /** The `/auth/exchange` half: a shell presents the code it caught. */
  async signInFromHandOff(code: string, handOff: string): Promise<Session> {
    const state = this.handOff.consume(handOff);
    if (!state) {
      throw new UnauthorizedException("Sign-in took too long. Try again.");
    }
    return this.signIn(state.inst, code, state.delegation_id);
  }

  /**
   * The session behind a credential, or `null` — expired, unknown, or ended at
   * the person's instance. Expiry and revocation both delete on the way out, so
   * a credential that stops working stops costing a row.
   */
  async resolve(credential: string): Promise<SessionRow | null> {
    const row = await this.sessions.find(credential);
    if (!row) return null;

    if (Date.parse(row.expires_at) <= Date.now()) {
      await this.sessions.end(credential);
      return null;
    }

    if ((await this.stillDelegated(row)) === "ended") {
      this.logger.log(
        `Delegation ended for ${row.created_by}; sessions closed`,
      );
      await this.sessions.endAll(row.created_by, row.syr_instance_url);
      return null;
    }

    return row;
  }

  async signOut(credential: string): Promise<void> {
    await this.sessions.end(credential);
  }

  private stillDelegated(row: SessionRow): Promise<DelegationState> {
    const key = row.id.toString();
    const cached = this.rechecks.get(key);
    if (cached && Date.now() - cached.at < RECHECK_MS) return cached.state;

    const state = this.syr.delegationState(delegationOf(row));
    this.rechecks.set(key, { at: Date.now(), state });
    for (const [seen, check] of this.rechecks) {
      if (Date.now() - check.at >= RECHECK_MS) this.rechecks.delete(seen);
    }
    return state;
  }
}
