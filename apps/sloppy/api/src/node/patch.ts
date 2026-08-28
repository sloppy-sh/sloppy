// How a PATCH reaches the store, shared by the domain repositories.

import { nowIso } from "@sloppy/types";

/**
 * The `SET` clause that writes `changes`, and the parameters it reads. A column
 * is replaced rather than merged into: `UPDATE … MERGE` folds a value into the
 * stored one, so a tag taken off a note would survive.
 *
 * Only `columns` can name a column, so nothing a request smuggled past its
 * schema reaches the statement.
 */
export function replacement<T extends object>(
  columns: readonly Extract<keyof T, string>[],
  changes: T,
): {
  clause: string;
  vars: { changes: Record<string, unknown>; now: string };
} {
  const written = columns.filter((column) => changes[column] !== undefined);
  return {
    clause: [
      ...written.map((column) => `${column} = $changes.${column}`),
      "updated_at = $now",
    ].join(", "),
    vars: {
      changes: Object.fromEntries(
        written.map((column) => [column, changes[column]]),
      ),
      now: nowIso(),
    },
  };
}
