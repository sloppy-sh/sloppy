import { createServer, type Server } from "node:http";
import { createServer as createSocket } from "node:net";
import { Logger } from "@nestjs/common";
import { DidSyrSchema, type TrustedInstance } from "@sloppy/types";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { AppConfigService } from "../config/app-config.service";
import { SyrService } from "./syr.service";
import { VouchService } from "./vouch.service";

const DID = DidSyrSchema.parse("did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva");
const DELEGATIONS = "/api/platform/delegations";
const IDENTITY = `/.well-known/syr/${encodeURIComponent(DID)}`;

/** What one instance answers, path by path, for one test. */
type Answers = Record<string, { status?: number; body?: unknown }>;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createSocket();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const found = probe.address();
      probe.close(() =>
        typeof found === "object" && found
          ? resolve(found.port)
          : reject(new Error("no free port")),
      );
    });
  });
}

/** A development machine reaching an instance on the same host, and a
 *  deployment that will not. */
function config(isProduction: boolean): AppConfigService {
  return {
    isProduction,
    publicUrl: "http://sloppy.example",
  } as unknown as AppConfigService;
}

describe("whether anybody stands behind an identity", () => {
  let server: Server;
  let origin: string;
  let answers: Answers = {};
  let asked: string[] = [];

  let port: number;

  beforeAll(async () => {
    port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    server = createServer((req, res) => {
      const path = new URL(req.url ?? "/", origin).pathname;
      asked.push(path);
      const held =
        answers[path] ??
        (path === "/.well-known/syr"
          ? {
              body: {
                name: "syr",
                public_url: origin,
                identity_manifest_template: `${origin}/.well-known/syr/{did}`,
                platform: {
                  consent: `${origin}/auth/platform-consent`,
                  token: `${origin}/api/platform/token`,
                  sign: `${origin}/api/platform/sign`,
                  challenge: `${origin}/api/platform/challenge`,
                  delegations: `${origin}${DELEGATIONS}`,
                  revoke: `${origin}/api/platform/revoke`,
                },
              },
            }
          : path === IDENTITY
            ? {
                body: {
                  version: 1,
                  did: DID,
                  provider: origin,
                  endpoints: {
                    profile: `${origin}/api/public/profile/${DID}`,
                    uploads: `${origin}/api/public/uploads/${DID}`,
                    did_document: `${origin}/api/identity/${DID}/document`,
                  },
                  web_profile: `${origin}/u/${DID}`,
                },
              }
            : { status: 404, body: {} });
      res
        .writeHead(held.status ?? 200, { "content-type": "application/json" })
        .end(JSON.stringify(held.body ?? null));
    });
    await new Promise<void>((resolve) =>
      server.listen(port, "127.0.0.1", resolve),
    );
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  beforeEach(() => {
    answers = {};
    asked = [];
  });

  function vouching(isProduction = false) {
    return new VouchService(new SyrService(), config(isProduction));
  }

  function at(word: TrustedInstance["word"] = "signed_in"): TrustedInstance {
    return { url: origin, word };
  }

  it("cannot say where nobody this reader trusts said where to look, and asks nobody", async () => {
    const answer = await vouching().vouchFor(DID);
    expect(answer.state).toBe("unknown");
    expect(answer.instance).toBeUndefined();
    expect(asked).toEqual([]);
  });

  it("cannot say where the record could not be reached", async () => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
    answers[IDENTITY] = { status: 404, body: {} };
    expect((await vouching().vouchFor(DID, at())).state).toBe("unknown");
  });

  it("cannot say where the record answered and the authority listing did not", async () => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
    answers[DELEGATIONS] = { status: 500, body: {} };
    expect((await vouching().vouchFor(DID, at())).state).toBe("unknown");
  });

  it("says vouched where the listing carries authority that still stands", async () => {
    answers[DELEGATIONS] = {
      body: {
        data: [
          {
            delegate_public_key: "z6MkOld",
            revoked_at: "2026-01-01T00:00:00Z",
          },
          { delegate_public_key: "z6MkNow" },
        ],
      },
    };
    const answer = await vouching().vouchFor(DID, at("typed"));
    expect(answer.state).toBe("vouched");
    expect(answer.instance).toBe(origin);
  });

  it("says anonymous where the listing answered with nothing standing", async () => {
    answers[DELEGATIONS] = { body: { data: [] } };
    expect((await vouching().vouchFor(DID, at())).state).toBe("anonymous");

    answers[DELEGATIONS] = {
      body: [
        { delegate_public_key: "z6MkGone", expires_at: "2020-01-01T00:00:00Z" },
      ],
    };
    expect((await vouching().vouchFor(DID, at("written_down"))).state).toBe(
      "anonymous",
    );
  });

  it("will not reach an address a deployment refuses, and connects to nothing", async () => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
    answers[DELEGATIONS] = {
      body: { data: [{ delegate_public_key: "z6Mk" }] },
    };
    expect((await vouching(true).vouchFor(DID, at())).state).toBe("unknown");
    expect(asked).toEqual([]);
  });
});
