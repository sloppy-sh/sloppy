import { describe, expect, it } from "vitest";
import { deriveIdpSecrets } from "./secrets.js";

describe("the derived secrets", () => {
  it("is stable, so tokens and sealed keys survive a restart", () => {
    const once = deriveIdpSecrets("z".repeat(48));
    const again = deriveIdpSecrets("z".repeat(48));
    expect(once.tokenSigning).toEqual(again.tokenSigning);
    expect(once.delegateSealing).toBe(again.delegateSealing);
  });

  it("gives each job its own key", () => {
    const { tokenSigning, delegateSealing } = deriveIdpSecrets("z".repeat(48));
    expect(delegateSealing).not.toBe(tokenSigning.toString("hex"));
  });

  it("separates two instances", () => {
    expect(deriveIdpSecrets("a".repeat(32)).delegateSealing).not.toBe(
      deriveIdpSecrets("b".repeat(32)).delegateSealing,
    );
  });

  it("refuses a secret short enough to guess", () => {
    expect(() => deriveIdpSecrets("short")).toThrow();
  });
});
