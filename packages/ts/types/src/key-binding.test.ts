import { describe, expect, it } from "vitest";
import {
  bindingFor,
  type BoundKey,
  type KeyBinding,
  signatureSchemeOf,
} from "./key-binding.js";

const AVA = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva";
const BEN = "mailto:ben@example.com";

function binding(scheme: KeyBinding["scheme"], keys: BoundKey[]): KeyBinding {
  return { scheme, keysFor: () => Promise.resolve(keys) };
}

describe("what scheme a signature is in", () => {
  it("reads an absent tag as what every signature before it was", () => {
    expect(signatureSchemeOf({})).toBe("ed25519-multibase");
  });

  it("reads one it can name", () => {
    expect(signatureSchemeOf({ signature_scheme: "openpgp" })).toBe("openpgp");
  });

  it("answers nothing for a scheme it cannot name, rather than guessing", () => {
    expect(signatureSchemeOf({ signature_scheme: "ml-dsa-87" })).toBeUndefined();
  });
});

describe("reaching the binding for an identifier", () => {
  const syr = binding("did:syr", []);
  const wkd = binding("mailto", []);

  it("picks the one for the principal's own scheme", () => {
    expect(bindingFor(AVA, [syr, wkd])).toBe(syr);
    expect(bindingFor(BEN, [syr, wkd])).toBe(wkd);
  });

  it("answers nothing where this build holds none for that scheme", () => {
    expect(bindingFor(BEN, [syr])).toBeUndefined();
  });

  it("answers nothing for a string that is not an identifier", () => {
    expect(bindingFor("ben@example.com", [syr, wkd])).toBeUndefined();
  });
});
