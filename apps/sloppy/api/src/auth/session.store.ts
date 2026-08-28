import { createHash, randomBytes } from "node:crypto";
import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  type DidSyr,
  type Timestamp,
  type Viewer,
  nowIso,
} from "@sloppy/types";
import { RecordId } from "surrealdb";
import { DbService } from "../db/db.service";
import type { Delegation } from "../syr/syr.service";

export const SESSION_TABLE = "session";

/**
 * The session table, kept here rather than in `@sloppy/data`'s `schema.ts`
 * because that literal is shared and this table is this module's alone.
 */
export const SESSION_SCHEMA = `
  DEFINE TABLE IF NOT EXISTS ${SESSION_TABLE} SCHEMALESS;

  DEFINE FIELD IF NOT EXISTS created_by ON ${SESSION_TABLE} TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_at ON ${SESSION_TABLE} TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS updated_at ON ${SESSION_TABLE} TYPE string;
  DEFINE FIELD IF NOT EXISTS expires_at ON ${SESSION_TABLE} TYPE string;

  DEFINE INDEX IF NOT EXISTS session_owner ON ${SESSION_TABLE} FIELDS created_by;
`;

/** Erasing one person's sessions, for the sweep `@sloppy/data`'s purge runs. */
export const SESSION_PURGE_STATEMENTS: readonly string[] = [
  `DELETE ${SESSION_TABLE} WHERE created_by = $did;`,
];

/**
 * An identity and the delegation Sloppy holds for it — and no profile, ever:
 * AI.md § "Sloppy's Vocabulary Stays Out of the Identity Store".
 */
export type SessionRow = {
  id: RecordId;
  created_by: DidSyr;
  syr_instance_url: string;
  delegate_public_key: string;
  /** Authenticates Sloppy AS this person, so it never enters a response. */
  access_token: string;
  expires_at: Timestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export interface NewSession {
  did: DidSyr;
  syr_instance_url: string;
  delegate_public_key: string;
  access_token: string;
  expires_at: Timestamp;
}

export interface IssuedSession {
  credential: string;
  row: SessionRow;
}

/** The public half of a session, which is all a client is ever told. */
export function viewerOf(session: SessionRow): Viewer {
  return {
    did: session.created_by,
    syr_instance_url: session.syr_instance_url,
    delegate_public_key: session.delegate_public_key,
  };
}

/** The half that speaks to the person's instance, credential included. */
export function delegationOf(session: SessionRow): Delegation {
  return {
    did: session.created_by,
    syr_instance_url: session.syr_instance_url,
    delegate_public_key: session.delegate_public_key,
    access_token: session.access_token,
  };
}

/**
 * The stored row is keyed by the credential's digest, not the credential. A
 * database dump, a log line, or a backup therefore carries nothing anybody can
 * sign in with, and the lookup is still a single keyed read.
 */
function keyFor(credential: string): RecordId {
  return new RecordId(
    SESSION_TABLE,
    createHash("sha256").update(credential).digest("hex"),
  );
}

@Injectable()
export class SessionStore implements OnModuleInit {
  /**
   * Every read here is behind the guard that runs before every route, so a call
   * left unsettled is the whole API stopping — including the public routes
   * somebody signs back in through. A socket outlives the server behind it for
   * however long it takes to notice, and a call written into one in that window
   * is never answered; `DbService.reachable` bounds itself for the same reason.
   */
  private static readonly TIMEOUT_MS = 2000;

  constructor(private readonly db: DbService) {}

  async onModuleInit(): Promise<void> {
    await this.db.handle.query(SESSION_SCHEMA);
  }

  async issue(session: NewSession): Promise<IssuedSession> {
    const credential = randomBytes(32).toString("base64url");
    const now = nowIso();
    const row: SessionRow = {
      id: keyFor(credential),
      created_by: session.did,
      syr_instance_url: session.syr_instance_url,
      delegate_public_key: session.delegate_public_key,
      access_token: session.access_token,
      expires_at: session.expires_at,
      created_at: now,
      updated_at: now,
    };
    await this.bounded(this.db.handle.create(row.id).content(row));
    await this.dropExpired(session.did, now);
    return { credential, row };
  }

  async find(credential: string): Promise<SessionRow | null> {
    return (
      (await this.bounded(
        this.db.handle.select<SessionRow>(keyFor(credential)),
      )) ?? null
    );
  }

  async end(credential: string): Promise<void> {
    await this.bounded(this.db.handle.delete(keyFor(credential)));
  }

  /** Every session this identity holds against this instance, everywhere. */
  async endAll(did: DidSyr, syrInstanceUrl: string): Promise<void> {
    await this.bounded(
      this.db.handle.query(
        `DELETE ${SESSION_TABLE} WHERE created_by = $did AND syr_instance_url = $instance;`,
        { did, instance: syrInstanceUrl },
      ),
    );
  }

  /** Signing in is the sweep: it is the one moment a person's row count grows. */
  private async dropExpired(did: DidSyr, now: Timestamp): Promise<void> {
    await this.bounded(
      this.db.handle.query(
        `DELETE ${SESSION_TABLE} WHERE created_by = $did AND expires_at < $now;`,
        { did, now },
      ),
    );
  }

  private async bounded<T>(work: PromiseLike<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error("the session store did not answer")),
            SessionStore.TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
