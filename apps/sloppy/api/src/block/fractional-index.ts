// Fractional indexing over base-62 digits: David Greenspan's scheme (Figma,
// "Realtime Editing of Ordered Sequences"), in the form Rocicorp's
// `fractional-indexing` package settled on. A key is a length-prefixed integer
// part plus an optional fractional tail, and plain lexicographic order over the
// keys IS the order of the blocks — `compareOrd` in `@sloppy/types`.
//
// Written out rather than depended on so the API keeps one runtime dependency
// fewer; the algorithm is not ours and must not be improvised on.

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const SMALLEST_INTEGER = `A${DIGITS[0].repeat(26)}`;

export class InvalidOrderKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOrderKeyError";
  }
}

function notAKey(key: string): InvalidOrderKeyError {
  return new InvalidOrderKeyError(`Not an order key: ${JSON.stringify(key)}`);
}

function outOfOrder(before: string, after: string): InvalidOrderKeyError {
  return new InvalidOrderKeyError(
    `Order keys ${JSON.stringify(before)} and ${JSON.stringify(after)} are the wrong way round`,
  );
}

/**
 * A key ordering strictly between `before` and `after`, either of which may be
 * `null` for "nothing on that side". Throws unless `before < after`.
 */
export function orderKeyBetween(
  before: string | null,
  after: string | null,
): string {
  if (before !== null) validateOrderKey(before);
  if (after !== null) validateOrderKey(after);
  if (before !== null && after !== null && before >= after) {
    throw outOfOrder(before, after);
  }

  if (before === null) {
    if (after === null) return `a${DIGITS[0]}`;
    const integer = integerPart(after);
    const fraction = after.slice(integer.length);
    if (integer === SMALLEST_INTEGER) return integer + midpoint("", fraction);
    if (integer < after) return integer;
    const decremented = decrementInteger(integer);
    if (decremented === null) throw notAKey(after);
    return decremented;
  }

  if (after === null) {
    const integer = integerPart(before);
    const incremented = incrementInteger(integer);
    return incremented === null
      ? integer + midpoint(before.slice(integer.length), null)
      : incremented;
  }

  const beforeInteger = integerPart(before);
  const afterInteger = integerPart(after);
  if (beforeInteger === afterInteger) {
    return (
      beforeInteger +
      midpoint(
        before.slice(beforeInteger.length),
        after.slice(afterInteger.length),
      )
    );
  }
  const incremented = incrementInteger(beforeInteger);
  if (incremented === null) throw notAKey(before);
  if (incremented < after) return incremented;
  return beforeInteger + midpoint(before.slice(beforeInteger.length), null);
}

/** How many characters the integer part takes, read off its own first one. */
function integerLength(head: string | undefined): number {
  if (head === undefined) throw notAKey("");
  if (head >= "a" && head <= "z") return head.charCodeAt(0) - 97 + 2;
  if (head >= "A" && head <= "Z") return 90 - head.charCodeAt(0) + 2;
  throw notAKey(head);
}

function integerPart(key: string): string {
  const length = integerLength(key[0]);
  if (length > key.length) throw notAKey(key);
  return key.slice(0, length);
}

function validateInteger(integer: string): void {
  if (integer.length !== integerLength(integer[0])) throw notAKey(integer);
}

export function validateOrderKey(key: string): void {
  if (key === SMALLEST_INTEGER) throw notAKey(key);
  const integer = integerPart(key);
  const fraction = key.slice(integer.length);
  if (fraction.slice(-1) === DIGITS[0]) throw notAKey(key);
}

function incrementInteger(integer: string): string | null {
  validateInteger(integer);
  const [head, ...digits] = integer.split("");
  let carry = true;
  for (let i = digits.length - 1; carry && i >= 0; i--) {
    const next = DIGITS.indexOf(digits[i]) + 1;
    if (next === DIGITS.length) {
      digits[i] = DIGITS[0];
    } else {
      digits[i] = DIGITS[next];
      carry = false;
    }
  }
  if (!carry) return head + digits.join("");
  if (head === "Z") return `a${DIGITS[0]}`;
  if (head === "z") return null;
  const wider = String.fromCharCode(head.charCodeAt(0) + 1);
  if (wider > "a") digits.push(DIGITS[0]);
  else digits.pop();
  return wider + digits.join("");
}

function decrementInteger(integer: string): string | null {
  validateInteger(integer);
  const [head, ...digits] = integer.split("");
  let borrow = true;
  for (let i = digits.length - 1; borrow && i >= 0; i--) {
    const next = DIGITS.indexOf(digits[i]) - 1;
    if (next === -1) {
      digits[i] = DIGITS[DIGITS.length - 1];
    } else {
      digits[i] = DIGITS[next];
      borrow = false;
    }
  }
  if (!borrow) return head + digits.join("");
  if (head === "a") return `Z${DIGITS[DIGITS.length - 1]}`;
  if (head === "A") return null;
  const narrower = String.fromCharCode(head.charCodeAt(0) - 1);
  if (narrower < "Z") digits.push(DIGITS[DIGITS.length - 1]);
  else digits.pop();
  return narrower + digits.join("");
}

/** A fractional tail strictly between two others, neither of which may end in
 *  the zero digit — the invariant `validateOrderKey` keeps. */
function midpoint(before: string, after: string | null): string {
  const zero = DIGITS[0];
  if (after !== null && before >= after) throw outOfOrder(before, after);
  if (before.slice(-1) === zero || (after && after.slice(-1) === zero)) {
    throw notAKey(after === null ? before : after);
  }
  if (after) {
    let shared = 0;
    while ((before[shared] || zero) === after[shared]) shared++;
    if (shared > 0) {
      return (
        after.slice(0, shared) +
        midpoint(before.slice(shared), after.slice(shared))
      );
    }
  }
  const low = before ? DIGITS.indexOf(before[0]) : 0;
  const high = after ? DIGITS.indexOf(after[0]) : DIGITS.length;
  if (high - low > 1) return DIGITS[Math.round(0.5 * (low + high))];
  if (after && after.length > 1) return after.slice(0, 1);
  return DIGITS[low] + midpoint(before.slice(1), null);
}
