import {
  BadRequestException,
  HttpException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Response } from "express";
import { describe, expect, it, vi } from "vitest";
import type { AppConfigService } from "../config/app-config.service";
import { AuthController } from "./auth.controller";
import type { AuthService } from "./auth.service";
import type { AuthedRequest } from "./authed-request";
import type { KeySignInService } from "./key-sign-in.service";
import { SESSION_COOKIE } from "./session-cookie";

const DEEP_LINK = "sloppy://auth/callback";
const CALLBACK = "https://sloppy.sh/api/auth/callback";

function controller(
  auth: Partial<AuthService>,
  publicUrl = "https://sloppy.sh",
  keySignIn: Partial<KeySignInService> = {},
) {
  return new AuthController(
    {
      callbackUrl: CALLBACK,
      readConsentState: () => ({ inst: "https://syr.is", redirect: DEEP_LINK }),
      issueHandOff: () => "hand-off-token",
      ...auth,
    } as unknown as AuthService,
    keySignIn as unknown as KeySignInService,
    { publicUrl } as AppConfigService,
  );
}

/** Records what the callback did instead of doing it. */
function response() {
  const sent: { redirect?: string; html?: string; cleared?: string } = {};
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
    clearCookie: (name: string) => {
      sent.cleared = name;
      return res;
    },
  } as unknown as Response;
  return { res, sent };
}

const asking = (extra: Partial<AuthedRequest> = {}) =>
  ({ headers: {}, ...extra }) as AuthedRequest;

describe("starting sign-in", () => {
  const CONSENT = "https://syr.is/auth/platform-consent";

  // A shell forwarding `?redirect=` sends the empty string when there is
  // nothing to forward.
  it("goes on without a redirect it could never honour", async () => {
    const consentRedirect = vi.fn().mockResolvedValue(CONSENT);
    const auth = controller({ consentRedirect });

    for (const redirect of ["", 0, null, {}]) {
      await expect(
        auth.login({ instance_url: "syr.is", redirect }),
      ).resolves.toEqual({ consent_url: CONSENT });
      expect(consentRedirect).toHaveBeenLastCalledWith({
        instance_url: "https://syr.is",
      });
    }
  });

  it("carries a redirect somebody did name", async () => {
    const consentRedirect = vi.fn().mockResolvedValue(CONSENT);

    await controller({ consentRedirect }).login({
      instance_url: "syr.is",
      redirect: DEEP_LINK,
    });

    expect(consentRedirect).toHaveBeenCalledWith({
      instance_url: "https://syr.is",
      redirect: DEEP_LINK,
    });
  });

  it("still asks for the instance where none was named", async () => {
    await expect(
      controller({}).login({ redirect: DEEP_LINK }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

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

describe("answering who is signed in", () => {
  it("answers nobody on the ordinary first visit", () => {
    expect(controller({}).me(asking())).toBeNull();
  });

  // A credential nobody could check is not one that names nobody, and saying
  // so is what sends a signed-in person back to the sign-in page.
  it("refuses where the credential could not be checked", () => {
    expect(() =>
      controller({}).me(asking({ sessionUnverified: true })),
    ).toThrow(ServiceUnavailableException);
  });
});

describe("signing out", () => {
  it("ends the session it was handed", async () => {
    const { res, sent } = response();
    const signOut = vi.fn().mockResolvedValue(undefined);

    await controller({ signOut }).logout(
      asking({ headers: { authorization: "Bearer good" } }),
      res,
    );

    expect(signOut).toHaveBeenCalledWith("good");
    expect(sent.cleared).toBe(SESSION_COOKIE);
  });

  it("gets somebody out of this browser even when the store will not answer", async () => {
    const { res, sent } = response();
    const signOut = vi
      .fn()
      .mockRejectedValue(new Error("Anonymous access not allowed"));

    await expect(
      controller({ signOut }).logout(
        asking({ headers: { authorization: "Bearer good" } }),
        res,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(sent.cleared).toBe(SESSION_COOKIE);
  });
});

describe("what a person hands somebody who wants to read them", () => {
  it("names where identities are made here and where this graph is served", () => {
    const auth = controller({ ownInstanceUrl: () => "https://sloppy.sh" });

    expect(auth.ownInstance()).toEqual({
      instance_url: "https://sloppy.sh",
      instance_origin: "https://sloppy.sh",
    });
  });

  // An instance that only delegates still serves a graph somebody can be
  // pointed at, so the two answers are independent.
  it("names the graph's instance where identities are made elsewhere", () => {
    const auth = controller(
      { ownInstanceUrl: () => null },
      "https://notes.example/",
    );

    expect(auth.ownInstance()).toEqual({
      instance_url: null,
      instance_origin: "https://notes.example",
    });
  });

  it("says nothing where the configured address is not one a peer could type", () => {
    const auth = controller({ ownInstanceUrl: () => null }, "not-an-address");

    expect(auth.ownInstance()).toEqual({ instance_url: null });
  });
});

describe("the door somebody signs their way through", () => {
  const TEXT = "Sloppy sign-in\n…";

  it("asks for something to sign as the address it was given", () => {
    const challenge = vi.fn().mockReturnValue({
      statement: TEXT,
      expires_at: "2099-01-01T00:00:00.000Z",
    });

    const answered = controller({}, "https://sloppy.sh", {
      challenge,
    }).challenge(asking(), { principal: "mailto:alice@example.com" });

    expect(challenge).toHaveBeenCalledWith("mailto:alice@example.com");
    expect(answered.statement).toBe(TEXT);
  });

  it("asks for an address where the body names nobody", () => {
    expect(() => controller({}).challenge(asking(), {})).toThrow(
      BadRequestException,
    );
  });

  it("passes the signed answer on whole", async () => {
    const answer = vi.fn().mockResolvedValue({ token: "a-credential" });

    await controller({}, "https://sloppy.sh", { answer }).answer(asking(), {
      statement: TEXT,
      signature: "-----BEGIN PGP SIGNATURE-----",
    });

    expect(answer).toHaveBeenCalledWith({
      statement: TEXT,
      signature: "-----BEGIN PGP SIGNATURE-----",
    });
  });

  it("asks for a signature where the body carries none", async () => {
    await expect(
      controller({}).answer(asking(), { statement: TEXT }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // Both routes answer without a session and both cost a signature check, so
  // one caller cannot work through somebody else's addresses on them.
  it("stops one caller spending the whole door", () => {
    const challenge = vi
      .fn()
      .mockReturnValue({ statement: TEXT, expires_at: "" });
    const auth = controller({}, "https://sloppy.sh", { challenge });
    const ask = () =>
      auth.challenge(asking({ ip: "198.51.100.7" }), {
        principal: "mailto:alice@example.com",
      });

    for (let spent = 0; spent < 20; spent++) ask();

    expect(ask).toThrow(HttpException);
  });
});
