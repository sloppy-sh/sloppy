// Composite record ids, and the two conversions that cross the wire.
//
// Every user-owned row is keyed `table:{ created_by: <did>, id: <ulid> }`. The
// owner is part of the key rather than a column alone, so a row is globally
// unique the moment it is written — which is what lets a peer hold somebody
// else's node without renaming it. Modelled on syr's `codecs.ts`.

import { RecordId } from "surrealdb";
import { ulid } from "ulid";
import type { OwnedRef } from "./common.js";

interface CompositeId {
  created_by: string;
  id: string;
}

/** Mint a row's key. Omit `localId` to draw a fresh ULID. */
export function createOwnedRecordId(
  table: string,
  did: string,
  localId?: string,
): RecordId {
  return new RecordId(table, { created_by: did, id: localId ?? ulid() });
}

export function isCompositeRecordId(recordId: RecordId): boolean {
  const key = recordId?.id as Record<string, unknown> | undefined;
  return (
    typeof key === "object" &&
    key !== null &&
    typeof key.created_by === "string" &&
    typeof key.id === "string"
  );
}

function requireComposite(recordId: RecordId): CompositeId {
  if (!isCompositeRecordId(recordId)) {
    throw new Error(
      `Expected a composite record id, got ${JSON.stringify(recordId?.id)}`,
    );
  }
  return recordId.id as unknown as CompositeId;
}

/** The owning DID. Throws if the id is not composite. */
export function extractDid(recordId: RecordId): string {
  return requireComposite(recordId).created_by;
}

/** The ULID half. Throws if the id is not composite. */
export function extractLocalId(recordId: RecordId): string {
  return requireComposite(recordId).id;
}

/** Rebuild a key from a route parameter, without trusting it to name a table. */
export function recordIdFromDidAndLocal(
  table: string,
  did: string,
  localId: string,
): RecordId {
  return new RecordId(table, { created_by: did, id: localId });
}

export function ownedRefFrom(recordId: RecordId): OwnedRef {
  const key = requireComposite(recordId);
  return `${key.created_by}/${key.id}`;
}

export function recordIdFromOwnedRef(table: string, ref: OwnedRef): RecordId {
  const separator = ref.lastIndexOf("/");
  if (separator < 1) {
    throw new Error(`Expected a <did>/<ulid> reference, got ${ref}`);
  }
  return recordIdFromDidAndLocal(
    table,
    ref.slice(0, separator),
    ref.slice(separator + 1),
  );
}

export { ulid } from "ulid";
