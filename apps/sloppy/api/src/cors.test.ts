import { describe, expect, it } from "vitest";
import { DENIAL_LOG_LIMIT, corsOrigin } from "./cors";

function policy(isProduction = true) {
  const warnings: string[] = [];
  const check = corsOrigin({
    allowedOrigins: ["https://sloppy.sh"],
    isProduction,
    warn: (message) => warnings.push(message),
  });
  const decide = (origin: string | undefined) => {
    const decisions: { err: Error | null; allow?: boolean }[] = [];
    check(origin, (err, allow) => decisions.push({ err, allow }));
    return decisions[0];
  };
  return { decide, warnings };
}

describe("the CORS origin check", () => {
  it("allows a request that carries no Origin at all", () => {
    expect(policy().decide(undefined).allow).toBe(true);
  });

  it("allows a configured origin and the native shell's own", () => {
    const { decide } = policy();
    expect(decide("https://sloppy.sh").allow).toBe(true);
    expect(decide("tauri://localhost").allow).toBe(true);
  });

  it("allows loopback and RFC1918 only outside production", () => {
    expect(policy(false).decide("http://192.168.1.4:5173").allow).toBe(true);
    expect(policy(true).decide("http://192.168.1.4:5173").allow).toBe(false);
  });

  it("refuses without an error, so a blocked page is not a 500", () => {
    expect(policy().decide("https://evil.example")).toEqual({
      err: null,
      allow: false,
    });
  });

  it("logs a repeated origin once", () => {
    const { decide, warnings } = policy();
    decide("https://evil.example");
    decide("https://evil.example");
    expect(warnings).toHaveLength(1);
  });

  it("stops logging past the limit, however many origins arrive", () => {
    const { decide, warnings } = policy();
    for (let i = 0; i < DENIAL_LOG_LIMIT * 100; i++) {
      expect(decide(`https://${i}.evil.example`).allow).toBe(false);
    }
    expect(warnings).toHaveLength(DENIAL_LOG_LIMIT);
  });
});
