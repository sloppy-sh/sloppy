// RFC 8785 JSON Canonicalization Scheme.
//
// A signature is over bytes, so every party that verifies one has to rebuild
// exactly these bytes from the same object. That is the whole contract: keys
// sorted by UTF-16 code unit, no insignificant whitespace, numbers in
// ECMAScript's shortest round-tripping form, strings escaped the way
// `JSON.stringify` escapes them.

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue | undefined };

function serialize(value: JsonValue | undefined): string {
  if (value === null || value === undefined) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error(`${value} has no canonical JSON form`);
      }
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new Error(`${typeof value} has no canonical JSON form`);
  }
  if (Array.isArray(value)) return `[${value.map(serialize).join(",")}]`;
  const members = Object.entries(value)
    .filter(([, member]) => member !== undefined)
    // Default string ordering IS UTF-16 code unit ordering, which is what JCS
    // specifies — not locale collation, and not code point order.
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, member]) => `${JSON.stringify(key)}:${serialize(member)}`);
  return `{${members.join(",")}}`;
}

export function canonicalize(value: JsonValue): string {
  return serialize(value);
}
