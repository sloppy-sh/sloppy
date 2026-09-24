import { afterEach, describe, expect, it, vi } from "vitest";
import { SignInChallenges } from "./challenge";

const HERE = "https://sloppy.sh";
const ALICE = "mailto:alice@example.com";
const TTL_MS = 10 * 60 * 1000;

function challenges(secret = "a-secret"): SignInChallenges {
  return new SignInChallenges(secret, TTL_MS);
}

describe("the text somebody signs", () => {
  afterEach(() => vi.useRealTimers());

  it("says who it is for and which Sloppy it is for, where a person can read it", () => {
    const { statement } = challenges().issue({
      principal: ALICE,
      origin: HERE,
    });

    expect(statement).toContain(ALICE);
    expect(statement).toContain(HERE);
  });

  it("reads back to what it was issued for", () => {
    const one = challenges();

    const read = one.read(
      one.issue({ principal: ALICE, origin: HERE }).statement,
    );

    expect(read?.claim).toEqual({ principal: ALICE, origin: HERE });
  });

  // Two statements for the same person differ, so one that was watched going
  // past is not the one this instance is waiting for next.
  it("is a different text every time", () => {
    const one = challenges();
    const claim = { principal: ALICE, origin: HERE };

    expect(one.issue(claim).statement).not.toBe(one.issue(claim).statement);
  });

  it("is not read by an instance that did not issue it", () => {
    const theirs = challenges("another-secret");

    expect(
      challenges().read(
        theirs.issue({ principal: ALICE, origin: HERE }).statement,
      ),
    ).toBeNull();
  });

  // The identity and the instance are what a person weighs before signing, so
  // changing either has to be changing the text the signature is over.
  it("is not read once a line has been rewritten", () => {
    const one = challenges();
    const { statement } = one.issue({ principal: ALICE, origin: HERE });

    expect(
      one.read(statement.replace(ALICE, "mailto:mallory@example.com")),
    ).toBeNull();
    expect(
      one.read(statement.replace(HERE, "https://not-sloppy.example")),
    ).toBeNull();
    expect(one.read(`${statement}\nand one more thing`)).toBeNull();
  });

  // Somebody pastes the text into a file, and what wrote the file decides the
  // line endings and whether there is a last empty line.
  it("is read the same after a round trip through an editor", () => {
    const one = challenges();
    const { statement } = one.issue({ principal: ALICE, origin: HERE });

    expect(one.read(`${statement}\n`)?.statement).toBe(statement);
    expect(one.read(statement.replaceAll("\n", "\r\n"))?.statement).toBe(
      statement,
    );
  });

  it("stops being read once it is old", () => {
    vi.useFakeTimers();
    const one = challenges();
    const { statement } = one.issue({ principal: ALICE, origin: HERE });

    vi.advanceTimersByTime(TTL_MS + 1);

    expect(one.read(statement)).toBeNull();
  });

  it("is spent once", () => {
    const one = challenges();
    const read = one.read(
      one.issue({ principal: ALICE, origin: HERE }).statement,
    );

    expect(one.spend(read?.token ?? "")).toBe(true);
    expect(one.spend(read?.token ?? "")).toBe(false);
  });

  it("says when it stops being good", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T10:00:00.000Z"));

    expect(
      challenges().issue({ principal: ALICE, origin: HERE }).expires_at,
    ).toBe("2026-09-24T10:10:00.000Z");
  });
});
