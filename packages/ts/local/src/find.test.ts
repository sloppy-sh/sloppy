import type { NotesFitting } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import { containerApi, performChatCall } from "./acts.js";
import { MemoryFiles } from "./files.js";
import {
  answeredByWords,
  type FindIndexed,
  SHORTLIST_MOST,
  shortlist,
} from "./find.js";
import { textDocument } from "./local.test-support.js";

function note(
  at: number,
  title: string,
  writing: string,
  more: Partial<FindIndexed> = {},
): FindIndexed {
  return {
    note: `did:key:z6Mk/${String(at).padStart(2, "0")}`,
    title,
    aliases: [],
    tags: [],
    writing,
    updated_at: `2026-11-${String(at).padStart(2, "0")}T00:00:00.000Z`,
    ...more,
  };
}

const TWELVE: FindIndexed[] = [
  note(1, "Why iroh", "We picked iroh over libp2p for the transport.", {
    address: "1",
    tags: ["transport"],
  }),
  note(2, "Pairing a headset", "A six-digit code pairs a headset with iroh."),
  note(3, "The field", "Marks are placed by what they sprang out of."),
  note(4, "Looks", "A look is a file of colours.", { address: "2" }),
  note(5, "Speech on the desk", "The desk hears the voice and keeps none."),
  note(6, "Threads", "A thread is a file on the desk."),
  note(7, "Drafts", "Each thread works in a draft of its own."),
  note(8, "Bins", "A deleted note goes to the bin.", {
    address: "3",
    aliases: ["9"],
  }),
  note(9, "Tags", "A tag is a plain string on a note."),
  note(10, "Sets", "The selected tags drawn as regions."),
  note(11, "Ink", "Pen draws, touch pans."),
  note(12, "Relay", "A relay that cannot read the lines.", {
    tags: ["transport"],
  }),
];

describe("the shortlist", () => {
  it("puts the note carrying the most of the words first", () => {
    const listed = shortlist(
      "the one about why we picked iroh over libp2p",
      TWELVE,
    );

    expect(listed[0]).toMatchObject({
      note: TWELVE[0].note,
      title: "Why iroh",
      address: "1",
      matched: ["picked", "iroh", "libp2p"],
    });
    expect(listed[1]).toMatchObject({
      note: TWELVE[1].note,
      matched: ["iroh"],
    });
    expect(listed).toHaveLength(2);
  });

  it("lists no more than it ranks among", () => {
    const many = Array.from({ length: SHORTLIST_MOST + 5 }, (_, at) =>
      note(at + 1, `Iroh ${at}`, "iroh"),
    );
    expect(shortlist("iroh", many)).toHaveLength(SHORTLIST_MOST);
  });

  it("puts a note at an address named first, or one that was at it", () => {
    expect(shortlist("the one at 2", TWELVE)[0]).toMatchObject({
      title: "Looks",
      cited: true,
    });
    expect(shortlist("what was at 9", TWELVE)[0]).toMatchObject({
      title: "Bins",
      cited: true,
    });
  });

  it("reads tags as well as titles and writing", () => {
    const listed = shortlist("transport", TWELVE);
    expect(listed.slice(0, 2).map((one) => one.title)).toEqual([
      "Why iroh",
      "Relay",
    ]);
  });

  it("answers the same way twice", () => {
    expect(shortlist("desk thread", TWELVE)).toEqual(
      shortlist("desk thread", [...TWELVE].reverse()),
    );
  });
});

describe("the words' own answer", () => {
  it("names the best where it carries half the words or more", () => {
    const said = "why we picked iroh over libp2p";
    const found = answeredByWords(said, shortlist(said, TWELVE));
    expect(found.best).toBe(TWELVE[0].note);
    expect(found.found[0]).toEqual({
      note: TWELVE[0].note,
      title: "Why iroh",
      address: "1",
      why: "Mentions picked, iroh and libp2p.",
    });
    expect(found.found).toHaveLength(2);
  });

  it("has no best where nothing clears the floor", () => {
    const said = "a gramophone in the garden shed with iroh";
    const found = answeredByWords(said, shortlist(said, TWELVE));
    expect(found.best).toBeUndefined();
    expect(found.found.map((one) => one.title)).toEqual([
      "Why iroh",
      "Pairing a headset",
    ]);
  });

  it("has nothing where nothing is said that any note carries", () => {
    const said = "gramophone";
    expect(answeredByWords(said, shortlist(said, TWELVE))).toEqual({
      found: [],
    });
  });
});

async function aProject(): Promise<MemoryFiles> {
  const files = new MemoryFiles({
    root: "/work/garden",
    data: "/work/garden-data",
  });
  await files.write("src/a.ts", new TextEncoder().encode("export {};\n"));
  const api = containerApi(files);
  await api.openProject("/work/garden");
  for (const [title, said] of [
    ["Why iroh", "We picked iroh over libp2p for the transport."],
    ["Pairing", "A code pairs a headset."],
    ["Looks", "A look is a file."],
  ] as const) {
    const made = await api.createNode({ title });
    await api.createBlock({ node: made.ref, content: textDocument(said) });
  }
  return files;
}

async function found(said: string) {
  const files = await aProject();
  const done = await performChatCall(files, {
    call: "call-1",
    act: "find_note",
    arguments: { said },
  });
  return {
    done,
    fitting: JSON.parse(done.said) as NotesFitting,
    notes: await containerApi(files).listNodes({}),
  };
}

describe("find_note, asked by an assistant", () => {
  it("answers the notes a description fits, the best first", async () => {
    const { done, fitting, notes } = await found(
      "why we picked iroh over libp2p",
    );
    const iroh = notes.find((one) => one.title === "Why iroh");
    expect(fitting.best).toBe(iroh?.ref);
    expect(fitting.found[0]).toEqual({
      note: iroh?.ref,
      title: "Why iroh",
      address: iroh?.address,
      why: "Mentions picked, iroh and libp2p.",
    });
    expect(done.facts).toEqual({ act: "find_note", count: 1 });
    expect(done.touched).toEqual([]);
  });

  it("finds a note by the address said", async () => {
    const { fitting, notes } = await found("the one at 3");
    expect(fitting.best).toBe(notes.find((one) => one.address === "3")?.ref);
  });

  it("has no best where nothing clears the floor", async () => {
    const { fitting } = await found("a gramophone in the shed");
    expect(fitting).toEqual({ found: [] });
  });
});
