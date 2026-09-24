import { describe, expect, it } from "vitest";
import { mailboxOf, wkdUrls } from "./wkd.js";

describe("the address an email principal is asked about at", () => {
  it("reads the two halves out of a principal", () => {
    expect(mailboxOf("mailto:Joe.Doe@Example.ORG")).toEqual({
      address: "joe.doe@example.org",
      local: "joe.doe",
      domain: "example.org",
    });
  });

  it("asks about nobody named in another scheme", () => {
    expect(
      mailboxOf("did:syr:z6MkpTHR8VNsBxYAAWHut2Geadd9jSLuFvdmsZ2mFmZjMxYZ"),
    ).toBeNull();
    expect(mailboxOf("alice@example.com")).toBeNull();
    expect(mailboxOf("mailto:alice@localhost")).toBeNull();
  });

  it("builds both forms the specification publishes", () => {
    const mailbox = mailboxOf("mailto:Joe.Doe@Example.ORG");
    expect(mailbox).not.toBeNull();
    expect(wkdUrls(mailbox as NonNullable<typeof mailbox>)).toEqual([
      "https://openpgpkey.example.org/.well-known/openpgpkey/example.org" +
        "/hu/iy9q119eutrkn8s1mk4r39qejnbu3n5q?l=joe.doe",
      "https://example.org/.well-known/openpgpkey" +
        "/hu/iy9q119eutrkn8s1mk4r39qejnbu3n5q?l=joe.doe",
    ]);
  });
});
