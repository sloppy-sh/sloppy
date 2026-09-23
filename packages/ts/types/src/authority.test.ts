import { describe, expect, it } from "vitest";
import { type WriteDecision, writeDecision } from "./authority.js";
import type { DidSyr } from "./common.js";
import type { Graph } from "./graph.js";
import { type Node, authorsOf, withAuthor, writeOutcome } from "./node.js";
import type { VouchState } from "./vouch.js";
import {
  ALL_PERMISSIONS,
  DEFAULT_PERMISSIONS,
  Permissions,
  maskBits,
} from "./permission.js";

const AVA = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva";
const BOB = "did:syr:z6MkBobBobBobBobBobBobBobBobBobBob";
const CAI = "did:syr:z6MkCaiCaiCaiCaiCaiCaiCaiCaiCaiCai";

type Gated = Pick<Node, "created_by" | "owner" | "authors">;

/** The note as a landed write leaves it, said the evaluator's way: it reports
 *  what it does to authorship, and this is that report applied. */
function asDecided(
  note: Gated,
  writer: DidSyr,
  decision: WriteDecision,
): Gated {
  return decision.coAuthors
    ? { ...note, authors: [...authorsOf(note), writer] }
    : note;
}

type Case = {
  note: Gated;
  writer: DidSyr;
  graph: Pick<Graph, "created_by" | "vouching">;
  vouch: VouchState;
};

/**
 * Every note a graph with no policy written on it can hold, against every
 * writer: the whole structural space of `owner` and `authors`, not a handful of
 * cases. A graph written before roles existed must answer exactly as it always
 * did, and this is what says so.
 */
function policylessCases(): Case[] {
  const owners = [undefined, AVA, BOB, CAI];
  const authorLists: Array<DidSyr[] | undefined> = [
    undefined,
    [],
    [AVA],
    [BOB],
    [AVA, BOB],
    [CAI],
  ];
  const graphs: Array<Pick<Graph, "created_by" | "vouching">> = [
    { created_by: AVA },
    { created_by: BOB },
    { created_by: AVA, vouching: "optional" },
  ];
  const vouches: VouchState[] = ["vouched", "anonymous", "unknown"];

  const cases: Case[] = [];
  for (const created_by of [AVA, BOB]) {
    for (const owner of owners) {
      for (const authors of authorLists) {
        for (const writer of [AVA, BOB, CAI]) {
          for (const graph of graphs) {
            for (const vouch of vouches) {
              cases.push({
                note: { created_by, owner, authors },
                writer,
                graph,
                vouch,
              });
            }
          }
        }
      }
    }
  }
  return cases;
}

/** mulberry32 — deterministic, and short enough to read. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("a graph with no policy written on it", () => {
  it("answers exactly what the note's own rule answers, over the whole space", () => {
    const cases = policylessCases();
    expect(cases.length).toBeGreaterThan(1000);

    for (const { note, writer, graph, vouch } of cases) {
      const decision = writeDecision({
        note,
        writer,
        graph,
        vouch,
        permissions: DEFAULT_PERMISSIONS,
      });
      expect(decision.verdict).toBe(writeOutcome(note, writer));
      expect(asDecided(note, writer, decision)).toEqual(
        withAuthor(note, writer),
      );
    }
  });

  it("answers the same over generated notes nobody picked", () => {
    const random = seededRandom(0x51099);
    const dids: DidSyr[] = [AVA, BOB, CAI];
    for (let i = 0; i < 5000; i++) {
      const pick = <T>(from: readonly T[]) =>
        from[Math.floor(random() * from.length)];
      const authors: DidSyr[] = [];
      for (let n = Math.floor(random() * 4); n > 0; n--)
        authors.push(pick(dids));
      const note: Gated = {
        created_by: pick(dids),
        owner: pick([undefined, ...dids]),
        authors: random() < 0.25 ? undefined : authors,
      };
      const writer = pick(dids);
      const decision = writeDecision({
        note,
        writer,
        graph: { created_by: pick(dids) },
        vouch: pick(["vouched", "anonymous", "unknown"] as const),
        permissions: DEFAULT_PERMISSIONS,
      });
      expect(decision.verdict).toBe(writeOutcome(note, writer));
      expect(asDecided(note, writer, decision)).toEqual(
        withAuthor(note, writer),
      );
    }
  });

  it("never refuses a write: nothing in it can", () => {
    for (const { note, writer, graph, vouch } of policylessCases()) {
      expect(
        writeDecision({
          note,
          writer,
          graph,
          vouch,
          permissions: DEFAULT_PERMISSIONS,
        }).verdict,
      ).not.toBe("refused");
    }
  });
});

describe("a graph that asks its writers to be vouched", () => {
  const graph = { created_by: AVA, vouching: "required" } as const;
  const note: Gated = { created_by: AVA, owner: undefined, authors: [AVA] };
  const asked = (writer: DidSyr, vouch: VouchState, held: Gated = note) =>
    writeDecision({
      note: held,
      writer,
      graph,
      vouch,
      permissions: DEFAULT_PERMISSIONS,
    });

  it("refuses an identity nobody stands behind", () => {
    expect(asked(BOB, "anonymous")).toEqual({
      verdict: "refused",
      coAuthors: false,
    });
  });

  it("takes writing from one somebody stands behind", () => {
    expect(asked(BOB, "vouched").verdict).toBe("lands");
  });

  it("admits nobody new while nothing answers, and offers their change", () => {
    expect(asked(BOB, "unknown")).toEqual({
      verdict: "offered",
      coAuthors: false,
    });
  });

  it("refuses the change of one it will not admit and takes no offers from", () => {
    expect(
      writeDecision({
        note,
        writer: BOB,
        graph,
        vouch: "unknown",
        permissions: DEFAULT_PERMISSIONS & ~Permissions.OFFER_CHANGE,
      }).verdict,
    ).toBe("refused");
  });

  it("takes nothing away from a writer the note already carries", () => {
    const written: Gated = {
      created_by: AVA,
      owner: undefined,
      authors: [AVA, BOB],
    };
    expect(asked(BOB, "unknown", written).verdict).toBe("lands");

    const theirs: Gated = { created_by: AVA, owner: BOB, authors: [AVA] };
    expect(asked(BOB, "unknown", theirs).verdict).toBe("lands");
  });

  it("never shuts its own owner out, however they are held", () => {
    expect(asked(AVA, "anonymous").verdict).toBe("lands");
  });
});

describe("a graph with roles written on it", () => {
  const graph = { created_by: AVA } as const;
  const open: Gated = { created_by: AVA, owner: undefined, authors: [AVA] };
  const own: Gated = { created_by: BOB, owner: undefined, authors: [BOB] };
  const gated: Gated = { created_by: AVA, owner: AVA, authors: [AVA] };
  const held = (note: Gated, permissions: bigint) =>
    writeDecision({ note, writer: BOB, graph, permissions, vouch: "unknown" });

  it("refuses a writer it grants nothing", () => {
    expect(held(open, 0n)).toEqual({ verdict: "refused", coAuthors: false });
  });

  it("lands a write it grants, and says the writer joins the note's authors", () => {
    expect(held(open, Permissions.WRITE_NOTES | Permissions.CO_AUTHOR)).toEqual(
      { verdict: "lands", coAuthors: true },
    );
  });

  it("offers a write it will not land, where it takes offers", () => {
    expect(held(open, Permissions.OFFER_CHANGE)).toEqual({
      verdict: "offered",
      coAuthors: false,
    });
  });

  it("will not let somebody join a note's authorship without being allowed to", () => {
    expect(
      held(open, Permissions.WRITE_NOTES | Permissions.OFFER_CHANGE).verdict,
    ).toBe("offered");
  });

  it("lands a write on a note its writer already authors, with no leave to join one", () => {
    expect(held(own, Permissions.WRITE_NOTES)).toEqual({
      verdict: "lands",
      coAuthors: false,
    });
  });

  it("holds an administrator to the note's own gate, and offers their change", () => {
    expect(held(gated, ALL_PERMISSIONS)).toEqual({
      verdict: "offered",
      coAuthors: false,
    });
  });

  it("refuses a change offered where it takes none", () => {
    expect(held(gated, maskBits("0")).verdict).toBe("refused");
  });

  it("leaves an owned note's authorship to its owner", () => {
    const theirs: Gated = { created_by: AVA, owner: BOB, authors: [AVA] };
    expect(held(theirs, Permissions.WRITE_NOTES)).toEqual({
      verdict: "lands",
      coAuthors: false,
    });
  });
});
