import { ServiceUnavailableException } from "@nestjs/common";
import type { Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { AuthController } from "./auth.controller";
import type { AuthService } from "./auth.service";

const DEEP_LINK = "sloppy://auth/callback";
const CALLBACK = "https://sloppy.sh/api/auth/callback";

function controller(auth: Partial<AuthService>) {
  return new AuthController({
    callbackUrl: CALLBACK,
    readConsentState: () => ({ inst: "https://syr.is", redirect: DEEP_LINK }),
    issueHandOff: () => "hand-off-token",
    ...auth,
  } as unknown as AuthService);
}

/** Records what the callback did instead of doing it. */
function response() {
  const sent: { redirect?: string; html?: string } = {};
  const res = {
    redirect: (url: string) => {
      sent.redirect = url;
    },
    status: () => res,
    type: () => res,
    send: (html: string) => {
      sent.html = html;
    },
    cookie: () => res,
  } as unknown as Response;
  return { res, sent };
}

describe("leaving the callback", () => {
  it("hands a shell the code to spend, on a page the browser will follow", async () => {
    const { res, sent } = response();

    await controller({ signIn: vi.fn() }).callback(
      "the-code",
      "state",
      "the-delegation",
      undefined,
      res,
    );

    expect(sent.redirect).toBeUndefined();
    expect(sent.html).toContain("sloppy_code=the-code");
    expect(sent.html).toContain("sloppy_state=hand-off-token");
    expect(sent.html).toContain("intent://auth/callback");
  });

  // A `Location:` to the app's own scheme is what Chrome on Android drops, so a
  // failure sent that way is a person left on a blank page with no way back.
  it("carries a failure to the same shell the same way", async () => {
    const { res, sent } = response();

    await controller({}).callback(
      undefined,
      "state",
      undefined,
      undefined,
      res,
    );

    expect(sent.redirect).toBeUndefined();
    expect(sent.html).toContain("sloppy_error=");
    expect(sent.html).toContain("intent://auth/callback");
    expect(sent.html).not.toContain("You&#x27;re signed in");
  });

  it("passes on the words the person's instance wrote for them", async () => {
    const { res, sent } = response();
    const signIn = vi
      .fn()
      .mockRejectedValue(
        new ServiceUnavailableException("Your instance is not answering."),
      );

    await controller({
      readConsentState: () => ({ inst: "https://syr.is", redirect: "/graph" }),
      signIn,
    }).callback("the-code", "state", "the-delegation", undefined, res);

    expect(sent.redirect).toBe(
      `/graph?${new URLSearchParams({ sloppy_error: "Your instance is not answering." })}`,
    );
  });

  it("redirects a target the browser follows on its own", async () => {
    const { res, sent } = response();

    await controller({
      readConsentState: () => ({ inst: "https://syr.is", redirect: "/graph" }),
      signIn: vi.fn().mockResolvedValue({
        token: "credential",
        expires_at: "2099-01-01T00:00:00.000Z",
        viewer: {},
      }),
    }).callback("the-code", "state", "the-delegation", undefined, res);

    expect(sent.html).toBeUndefined();
    expect(sent.redirect).toBe("/graph");
  });
});
