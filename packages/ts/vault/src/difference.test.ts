import type { BlockDocument, BlockView, NodeView } from "@sloppy/types";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { vaultDifference, type VaultDifference } from "./difference.js";
import { documents } from "./documents.test-support.js";
import {
  encodeText,
  mediaPath,
  PICTURES_FILE,
  picturesFile,
  type PictureSize,
  type Vault,
} from "./layout.js";
import type { EmojiDrawing } from "./markdown.js";
import { noteToVault } from "./note.js";

const DID = "did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE";
const NOTES = [
  "01J0000000000000000000000A",
  "01J0000000000000000000000B",
  "01J0000000000000000000000C",
];
const SECTIONS = [
  "01J000000000000000000000S1",
  "01J000000000000000000000S2",
  "01J000000000000000000000S3",
];
const UPLOADS = ["01J000000000000000000000U1", "01J000000000000000000000U2"];

interface Written {
  ulid: string;
  parent?: string;
  address?: string;
  title: string;
  sections: { ulid: string; content: BlockDocument }[];
}

function paragraph(text: string): BlockDocument {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

function ref(ulid: string): string {
  return `${DID}/${ulid}`;
}

/** The vault these notes are written into, with the pictures it holds beside
 *  them. */
function vaultOf(
  notes: readonly Written[],
  uploads: readonly string[] = [],
): Vault {
  const vault: Vault = new Map();
  let pictures: ReadonlyMap<string, PictureSize> = new Map();
  let emoji: ReadonlyMap<string, EmojiDrawing> = new Map();
  for (const note of notes) {
    const view = {
      ref: ref(note.ulid),
      ...(note.parent === undefined ? {} : { parent: ref(note.parent) }),
      ...(note.address === undefined ? {} : { address: note.address }),
      title: note.title,
      tags: [],
      links: [],
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    } as unknown as NodeView;
    const blocks = note.sections.map(
      (section, at) =>
        ({
          ref: ref(section.ulid),
          node: view.ref,
          ord: String.fromCharCode(97 + at),
          content: section.content,
        }) as unknown as BlockView,
    );
    const written = noteToVault(view, [], blocks, { pictures, emoji });
    for (const [path, bytes] of written.files) vault.set(path, bytes);
    pictures = written.pictures;
    emoji = written.emoji;
  }
  if (pictures.size > 0) vault.set(PICTURES_FILE, picturesFile(pictures));
  for (const upload of uploads) {
    vault.set(mediaPath(upload, "png"), encodeText(upload));
  }
  return vault;
}

const one: Written = {
  ulid: NOTES[0],
  address: "1",
  title: "A first thought",
  sections: [{ ulid: SECTIONS[0], content: paragraph("as it was") }],
};

describe("what changed between two states of a vault", () => {
  it("answers nothing for a vault against itself", () => {
    const vault = vaultOf([one], UPLOADS);
    expect(vaultDifference(vault, vault)).toEqual(empty());
  });

  it("names the notes that arrived and the ones that went", () => {
    const second: Written = {
      ulid: NOTES[1],
      parent: NOTES[0],
      address: "1a",
      title: "What it led to",
      sections: [],
    };
    const held = vaultDifference(vaultOf([one]), vaultOf([one, second]));

    expect(held.notes.added).toEqual([ref(NOTES[1])]);
    expect(held.notes.removed).toEqual([]);
    expect(vaultDifference(vaultOf([one, second]), vaultOf([one]))).toEqual({
      ...empty(),
      notes: { ...empty().notes, removed: [ref(NOTES[1])] },
    });
  });

  it("says which parent a note left and which it joined", () => {
    const was: Written = { ...one, ulid: NOTES[1], parent: NOTES[0] };
    const now: Written = { ...was, parent: NOTES[2] };

    expect(vaultDifference(vaultOf([was]), vaultOf([now])).notes.moved).toEqual(
      [{ ref: ref(NOTES[1]), from: ref(NOTES[0]), to: ref(NOTES[2]) }],
    );
  });

  it("leaves out the side a note had no parent on", () => {
    const now: Written = { ...one, parent: NOTES[1] };

    expect(vaultDifference(vaultOf([one]), vaultOf([now])).notes.moved).toEqual(
      [{ ref: ref(NOTES[0]), to: ref(NOTES[1]) }],
    );
  });

  it("says what a note was retitled and renumbered from", () => {
    const now: Written = {
      ...one,
      title: "A first thought, again",
      address: "2",
    };
    const held = vaultDifference(vaultOf([one]), vaultOf([now]));

    expect(held.notes.retitled).toEqual([
      {
        ref: ref(NOTES[0]),
        from: "A first thought",
        to: "A first thought, again",
      },
    ]);
    expect(held.notes.renumbered).toEqual([
      { ref: ref(NOTES[0]), from: "1", to: "2" },
    ]);
  });

  it("answers section by section, and by the section's own ulid", () => {
    const now: Written = {
      ...one,
      sections: [
        { ulid: SECTIONS[0], content: paragraph("as it is") },
        { ulid: SECTIONS[1], content: paragraph("and one more") },
      ],
    };

    expect(
      vaultDifference(vaultOf([one]), vaultOf([now])).notes.changed,
    ).toEqual([
      {
        ref: ref(NOTES[0]),
        sections: {
          added: [SECTIONS[1]],
          removed: [],
          changed: [SECTIONS[0]],
          reordered: false,
        },
      },
    ]);
  });

  it("sees a section moved above the one it was under", () => {
    const was: Written = {
      ...one,
      sections: [
        { ulid: SECTIONS[0], content: paragraph("first") },
        { ulid: SECTIONS[1], content: paragraph("second") },
      ],
    };
    const now: Written = { ...was, sections: [...was.sections].reverse() };
    const held = vaultDifference(vaultOf([was]), vaultOf([now])).notes.changed;

    expect(held).toEqual([
      {
        ref: ref(NOTES[0]),
        sections: { added: [], removed: [], changed: [], reordered: true },
      },
    ]);
  });

  it("names the pictures the vault gained and lost", () => {
    const held = vaultDifference(
      vaultOf([one], [UPLOADS[0]]),
      vaultOf([one], [UPLOADS[1]]),
    );

    expect(held.media).toEqual({ added: [UPLOADS[1]], removed: [UPLOADS[0]] });
  });

  it("leaves a file in notes/ that is nobody's note alone", () => {
    const vault = vaultOf([one]);
    const beside = new Map(vault);
    beside.set(
      "notes/01J000000000000000000000ZZ.md",
      encodeText("Somebody's own notes.\n"),
    );

    expect(vaultDifference(vault, beside)).toEqual(empty());
  });
});

const written: fc.Arbitrary<Written> = fc
  .record({
    ulid: fc.constantFrom(...NOTES),
    parent: fc.option(fc.constantFrom(...NOTES), { nil: undefined }),
    address: fc.option(fc.constantFrom("1", "1a", "1b", "2"), {
      nil: undefined,
    }),
    title: fc.constantFrom("", "One", "Another"),
    sections: fc.uniqueArray(
      fc.record({
        ulid: fc.constantFrom(...SECTIONS),
        content: documents(),
      }),
      { selector: (section) => section.ulid, maxLength: 3 },
    ),
  })
  .map(({ parent, address, ...rest }) => ({
    ...rest,
    ...(parent === undefined || parent === rest.ulid ? {} : { parent }),
    ...(address === undefined ? {} : { address }),
  }));

const vaults: fc.Arbitrary<Vault> = fc
  .tuple(
    fc.uniqueArray(written, { selector: (note) => note.ulid, maxLength: 3 }),
    fc.subarray([...UPLOADS]),
  )
  .map(([notes, uploads]) => vaultOf(notes, uploads));

describe("a difference over any two states", () => {
  it("is empty against the same state", { timeout: 60_000 }, () => {
    fc.assert(
      fc.property(vaults, (vault) => {
        expect(vaultDifference(vault, vault)).toEqual(empty());
      }),
      { numRuns: 500 },
    );
  });

  it("read the other way round, is itself inverted", {
    timeout: 60_000,
  }, () => {
    fc.assert(
      fc.property(vaults, vaults, (a, b) => {
        expect(vaultDifference(b, a)).toEqual(inverted(vaultDifference(a, b)));
      }),
      { numRuns: 500 },
    );
  });
});

function empty(): VaultDifference {
  return {
    notes: {
      added: [],
      removed: [],
      moved: [],
      retitled: [],
      renumbered: [],
      changed: [],
    },
    media: { added: [], removed: [] },
  };
}

/** The same difference, read from the other state. */
function inverted(held: VaultDifference): VaultDifference {
  return {
    notes: {
      added: held.notes.removed,
      removed: held.notes.added,
      moved: held.notes.moved.map(({ ref: at, from, to }) => ({
        ref: at,
        ...(to === undefined ? {} : { from: to }),
        ...(from === undefined ? {} : { to: from }),
      })),
      retitled: held.notes.retitled.map(({ ref: at, from, to }) => ({
        ref: at,
        from: to,
        to: from,
      })),
      renumbered: held.notes.renumbered.map(({ ref: at, from, to }) => ({
        ref: at,
        ...(to === undefined ? {} : { from: to }),
        ...(from === undefined ? {} : { to: from }),
      })),
      changed: held.notes.changed.map(({ ref: at, sections }) => ({
        ref: at,
        sections: {
          added: sections.removed,
          removed: sections.added,
          changed: sections.changed,
          reordered: sections.reordered,
        },
      })),
    },
    media: { added: held.media.removed, removed: held.media.added },
  };
}
