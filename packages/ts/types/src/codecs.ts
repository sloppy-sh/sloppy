// Composite record ids, and the two conversions that cross the wire.
//
// Every user-owned row is keyed `table:{ created_by: <principal>, id: <ulid> }`;
// docs/ARCHITECTURE.md § "Data model" says why the owner is half of the key
// rather than a column alone. Modelled on syr's `codecs.ts`.
//
// The key is an object, so an owner's own characters reach the driver as a
// value and are never spelled into a query.

import { RecordId } from "surrealdb";
import { ulid } from "ulid";
import type { DidSyr, OwnedRef, Principal, StoreRef } from "./common.js";

interface CompositeId {
  created_by: string;
  id: string;
}

/** Mint a row's key. Omit `localId` to draw a fresh ULID. */
export function createOwnedRecordId(
  table: string,
  owner: string,
  localId?: string,
): RecordId {
  return new RecordId(table, { created_by: owner, id: localId ?? ulid() });
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

/** Whose row it is. Throws if the id is not composite. */
export function extractOwner(recordId: RecordId): string {
  return requireComposite(recordId).created_by;
}

/** The ULID half. Throws if the id is not composite. */
export function extractLocalId(recordId: RecordId): string {
  return requireComposite(recordId).id;
}

/** Rebuild a key from a route parameter, without trusting it to name a table. */
export function recordIdFromOwnerAndLocal(
  table: string,
  owner: string,
  localId: string,
): RecordId {
  return new RecordId(table, { created_by: owner, id: localId });
}

export function ownedRefFrom(recordId: RecordId): OwnedRef {
  const key = requireComposite(recordId);
  return `${key.created_by}/${key.id}`;
}

/** The two halves of a reference: whose row it is, and which one. A principal
 *  carries separators of its own, so the split is at the last `/` and never the
 *  first. */
export function splitOwnedRef(ref: OwnedRef): {
  owner: Principal;
  localId: string;
} {
  const separator = ref.lastIndexOf("/");
  if (separator < 1) {
    throw new Error(`Expected a <principal>/<ulid> reference, got ${ref}`);
  }
  return { owner: ref.slice(0, separator), localId: ref.slice(separator + 1) };
}

export function recordIdFromOwnedRef(table: string, ref: OwnedRef): RecordId {
  const { owner, localId } = splitOwnedRef(ref);
  return recordIdFromOwnerAndLocal(table, owner, localId);
}

/** How an identity store's own record is cited: `<did>:<local id>`. */
export function storeRefFor(did: DidSyr, localId: string): StoreRef {
  return `${did}:${localId}`;
}

/**
 * The two halves of one. The DID is matched rather than counted to: a local id
 * is the issuing store's to mint and may carry colons of its own, so splitting
 * at the last of them would hand back a DID with part of the id stuck to it.
 */
export function splitStoreRef(ref: StoreRef): {
  did: DidSyr;
  localId: string;
} {
  const did = /^did:syr:z[1-9A-HJ-NP-Za-km-z]+/.exec(ref)?.[0];
  if (
    did === undefined ||
    ref[did.length] !== ":" ||
    did.length + 1 === ref.length
  ) {
    throw new Error(`Expected a <did>:<local id> reference, got ${ref}`);
  }
  return { did, localId: ref.slice(did.length + 1) };
}

export { ulid } from "ulid";
