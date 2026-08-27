import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * A short-lived token that carries its own payload:
 * `<base64url(json)>.<hmac>`. Nothing is stored to issue one, so it survives a
 * restart and works across several API processes.
 *
 * The payload rides INSIDE the token so the callback URL can stay static —
 * docs/ARCHITECTURE.md § "Auth: Platform Delegation v0.1" says why a query
 * parameter on that URL would not survive the round trip.
 *
 * A token is read one of two ways, and the caller picks: {@link consume} spends
 * it, {@link verify} does not. Single use is enforced in memory, so a replay
 * reaching another process is bounded by the TTL alone. Keep the TTL short.
 */
export class SignedTokens<T extends object> {
  private readonly consumed = new Map<string, number>();

  constructor(
    private readonly secret: string,
    private readonly ttlMs: number,
  ) {}

  issue(payload: T): string {
    const envelope = {
      ...payload,
      n: randomBytes(18).toString("base64url"),
      t: Date.now(),
    };
    const encoded = Buffer.from(JSON.stringify(envelope), "utf8").toString(
      "base64url",
    );
    return `${encoded}.${this.sign(encoded)}`;
  }

  /** Spends the token: a second presentation of it answers null. */
  consume(token: string): T | null {
    const payload = this.verify(token);
    if (!payload) return null;

    this.prune();
    if (this.consumed.has(token)) return null;
    this.consumed.set(token, Date.now());
    return payload;
  }

  /** Leaves the token spendable, for one presented on every load of a picture
   *  rather than redeemed once. */
  verify(token: string): T | null {
    const [encoded, signature, ...rest] = token.split(".");
    if (!encoded || !signature || rest.length) return null;

    const expected = Buffer.from(this.sign(encoded), "base64url");
    const given = Buffer.from(signature, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected))
      return null;

    let envelope: T & { n?: unknown; t?: unknown };
    try {
      envelope = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    } catch {
      return null;
    }
    if (typeof envelope?.t !== "number" || Date.now() - envelope.t > this.ttlMs)
      return null;

    const { n: _nonce, t: _issuedAt, ...payload } = envelope;
    return payload as T;
  }

  private sign(encoded: string): string {
    return createHmac("sha256", this.secret)
      .update(encoded)
      .digest("base64url");
  }

  /** A token past its TTL fails on the timestamp, so remembering it is waste. */
  private prune(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [token, at] of this.consumed) {
      if (at < cutoff) this.consumed.delete(token);
    }
  }
}
