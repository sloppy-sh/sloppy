// How an integration suite puts its own database away. Every suite in this
// package runs against one server at once, and `REMOVE DATABASE` takes a lock
// the whole namespace contends for, so a suite finishing while its siblings are
// still writing is told to try again rather than told it failed.

import type { Surreal } from "surrealdb";

const ATTEMPTS = 10;
const PAUSE_MS = 50;

/** Whether SurrealDB refused this only because something else held the lock. */
function retriable(error: unknown): boolean {
  return (
    error instanceof Error && /transaction can be retried/i.test(error.message)
  );
}

/** Drops `database`, waiting out the sibling suites that hold the namespace. */
export async function dropDatabase(
  db: Surreal,
  database: string,
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await db.query(`REMOVE DATABASE IF EXISTS ${database};`);
      return;
    } catch (error) {
      if (attempt === ATTEMPTS || !retriable(error)) throw error;
      await new Promise((wake) => setTimeout(wake, PAUSE_MS * attempt));
    }
  }
}
