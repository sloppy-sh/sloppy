import type { Domain, Principal, Whereabouts } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import {
  type WhereaboutsAnswer,
  whereaboutsFrom,
  whereaboutsUrl,
} from "./whereabouts";

const ALICE = "mailto:alice@example.com" as Principal;
const SYR = "did:syr:z6MktAaaaaaaaaaaaaaaaaaaaaaaa" as Principal;

function said(
  instance: string,
  domain?: string,
  principal: Principal = ALICE,
): WhereaboutsAnswer {
  return {
    answer: "said",
    whereabouts: {
      principal,
      instance,
      ...(domain === undefined ? {} : { domain }),
    } as Whereabouts,
  };
}

/** One resolution, with what each source says and every domain it asked. */
async function asking(sources: {
  domains?: Record<string, WhereaboutsAnswer>;
  instance?: WhereaboutsAnswer;
  principal?: Principal;
}): Promise<{ answer: WhereaboutsAnswer; asked: Domain[] }> {
  const asked: Domain[] = [];
  const answer = await whereaboutsFrom({
    principal: sources.principal ?? ALICE,
    atDomain: (domain) => {
      asked.push(domain);
      return Promise.resolve(
        sources.domains?.[domain] ?? { answer: "unreachable" },
      );
    },
    atInstance: () =>
      Promise.resolve(sources.instance ?? { answer: "unreachable" }),
  });
  return { answer, asked };
}

describe("where a declaration is served", () => {
  it("is one path at the site root, whichever is answering", () => {
    expect(whereaboutsUrl("https://example.com", ALICE)).toBe(
      "https://example.com/.well-known/sloppy-whereabouts/mailto%3Aalice%40example.com",
    );
  });

  it("keeps an instance's own port and scheme", () => {
    expect(whereaboutsUrl("http://127.0.0.1:8040", SYR)).toBe(
      `http://127.0.0.1:8040/.well-known/sloppy-whereabouts/${encodeURIComponent(SYR)}`,
    );
  });
});

describe("asking where somebody's graph is", () => {
  it("takes their own domain's word over the instance's", async () => {
    const { answer, asked } = await asking({
      domains: { "example.com": said("https://home.example") },
      instance: said("https://host.example"),
    });
    expect(answer).toEqual(said("https://home.example"));
    expect(asked).toEqual(["example.com"]);
  });

  it("falls to the instance named alongside where the domain says nothing", async () => {
    const { answer } = await asking({
      domains: { "example.com": { answer: "none" } },
      instance: said("https://host.example"),
    });
    expect(answer).toEqual(said("https://host.example"));
  });

  it("asks the domain the instance's answer names, and takes its word", async () => {
    const alice = "mailto:alice@mailbox.example" as Principal;
    const { answer, asked } = await asking({
      principal: alice,
      domains: {
        "mailbox.example": { answer: "none" },
        "alice.example": said("https://home.example", "alice.example", alice),
      },
      instance: said("https://host.example", "alice.example", alice),
    });
    expect(answer).toEqual(
      said("https://home.example", "alice.example", alice),
    );
    expect(asked).toEqual(["mailbox.example", "alice.example"]);
  });

  it("keeps the instance's answer where the domain it names says nothing", async () => {
    const { answer } = await asking({
      domains: { "example.com": { answer: "none" } },
      instance: said("https://host.example", "elsewhere.example"),
    });
    expect(answer).toEqual(said("https://host.example", "elsewhere.example"));
  });

  it("asks no domain twice, so two declarations cannot pass a reader back and forth", async () => {
    const { answer, asked } = await asking({
      domains: { "example.com": { answer: "none" } },
      instance: said("https://host.example", "example.com"),
    });
    expect(answer).toEqual(said("https://host.example", "example.com"));
    expect(asked).toEqual(["example.com"]);
  });

  it("follows a domain named by a domain nowhere", async () => {
    const { answer, asked } = await asking({
      domains: {
        "example.com": said("https://home.example", "second.example"),
        "second.example": said("https://elsewhere.example"),
      },
      instance: { answer: "none" },
    });
    expect(answer).toEqual(said("https://home.example", "second.example"));
    expect(asked).toEqual(["example.com"]);
  });

  it("asks no domain for an identifier that carries none", async () => {
    const { answer, asked } = await asking({
      principal: SYR,
      instance: said("https://host.example", undefined, SYR),
    });
    expect(answer).toEqual(said("https://host.example", undefined, SYR));
    expect(asked).toEqual([]);
  });

  it("says nobody says where they are when a source answers and none does", async () => {
    const { answer } = await asking({
      domains: { "example.com": { answer: "none" } },
      instance: { answer: "none" },
    });
    expect(answer).toEqual({ answer: "none" });
  });

  it("keeps being told nobody says apart from nothing answering", async () => {
    expect((await asking({})).answer).toEqual({ answer: "unreachable" });
    expect(
      (await asking({ domains: { "example.com": { answer: "none" } } })).answer,
    ).toEqual({ answer: "none" });
    expect((await asking({ instance: { answer: "none" } })).answer).toEqual({
      answer: "none",
    });
  });
});
