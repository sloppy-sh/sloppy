// One note as one file, and back — docs/ARCHITECTURE.md § "A graph on disk".

import {
  type Address,
  AddressSchema,
  type BlockDocument,
  type BlockView,
  CommitIdSchema,
  type Principal,
  PrincipalSchema,
  type EdgeLook,
  EdgeLookSchema,
  isUnstyled,
  looksRead,
  looksWritten,
  type NodeAppearance,
  NodeAppearanceSchema,
  type NodeView,
  type OwnedRef,
  OwnedRefSchema,
  splitOwnedRef,
  type Timestamp,
  TimestampSchema,
  UlidSchema,
} from "@sloppy/types";
import {
  type FrontBlock,
  type FrontEntries,
  type FrontValue,
  frontBlock,
  frontEntries,
  frontList,
  frontString,
  splitNoteFile,
  writeFront,
} from "./front.js";
import { inkSvg } from "./ink.js";
import {
  encodeText,
  inkImagePath,
  inkPath,
  notePath,
  type PictureSize,
  SECTION_OPENER,
  VaultFormatError,
} from "./layout.js";
import {
  type EmojiDrawing,
  emptySidecars,
  fromMarkdown,
  type Sidecars,
  toMarkdown,
} from "./markdown.js";

export interface VaultSection {
  /** The block's own ULID; its owner is the note's. */
  ulid: string;
  content: BlockDocument;
}

/** A section as its file is written from: a note's stored one, or one an offer
 *  proposes. Both are named by a ref and carry the editor's own document. */
export interface WrittenSection {
  ref: OwnedRef;
  content: BlockDocument;
}

/** A note as a vault carries it. Everything a reader re-derives — the depth,
 *  the origin, the notes this one's writing names — is not here. */
export interface VaultNote {
  ref: OwnedRef;
  /** Absent on a branch and on an independent note. */
  parent?: OwnedRef;
  /** Absent on a note with none. */
  address?: Address;
  aliases: Address[];
  /** Who gates the note's writing. Absent is an open note. */
  owner?: Principal;
  /** Whose writing it carries, in order of first writing. **Absent is the
   *  ref's own owner alone** — the canonical form, so that is the one case not
   *  written down. */
  authors?: Principal[];
  /** Whose offered change its owner has taken in. Absent is none. */
  contributors?: Principal[];
  tags: string[];
  links: OwnedRef[];
  /** The looks its author set on the lines out of it, one per note at the other
   *  end. Absent is a note nobody set one on. */
  edges?: EdgeLook[];
  title: string;
  /** How its author asked the mark to be drawn. Absent is a note nobody
   *  styled, which is not itself a look. */
  appearance?: NodeAppearance;
  /** Absent where the file did not say, which is a file a hand has been in. */
  created?: Timestamp;
  updated?: Timestamp;
  /** The commit its author last read the note's reasoning against. Absent is a
   *  note nobody has confirmed, which is UNREAD and never out of date. */
  checked?: string;
  sections: VaultSection[];
}

/** What the vault already holds when a note is written into it. */
export interface VaultSoFar {
  /** Where each upload's bytes are in the vault, keyed by upload id. An upload
   *  missing from it is linked by its id alone, which is still what reads
   *  back. */
  media?: ReadonlyMap<string, string>;
  /** `.sloppy/pictures.json` as the notes written so far leave it. */
  pictures?: ReadonlyMap<string, PictureSize>;
  /** The emoji catalog as the notes written so far leave it. */
  emoji?: ReadonlyMap<string, EmojiDrawing>;
}

/** The files one note writes into a vault, and the vault's own picture sizes
 *  and emoji catalog with this note's in them. */
export interface NoteFiles {
  files: Map<string, Uint8Array>;
  /** `.sloppy/pictures.json`. */
  pictures: Map<string, PictureSize>;
  /** How each shortcode the notes are written with draws. `src` is wherever the
   *  writer's catalog holds the picture; a reader hands back whatever it will
   *  draw the shortcode with, which is what the note then carries. */
  emoji: Map<string, EmojiDrawing>;
}

/**
 * One note as its file, with each drawing written beside it. `blocks` are the
 * note's sections in the order they are read in.
 *
 * Hand the returned `pictures` and `emoji` back in through `held` for the next
 * note: one upload at two sizes, or one shortcode drawn two ways, comes back
 * exact only where this call can see the first of them.
 */
export function noteToVault(
  note: NodeView,
  aliases: readonly Address[],
  blocks: readonly BlockView[],
  held: VaultSoFar = {},
): NoteFiles {
  const front = writeFront([
    ["ref", note.ref],
    ["parent", note.parent],
    ["address", note.address],
    ["aliases", [...aliases]],
    ["owner", note.owner],
    ["authors", writtenAuthors(note)],
    ["contributors", [...(note.contributors ?? [])]],
    ["tags", [...note.tags]],
    ["links", [...note.links]],
    ["edges", edgeEntries(note.edges)],
    ["title", note.title],
    ["created", note.created_at],
    ["updated", note.updated_at],
    ["checked", note.checked],
    ["appearance", lookBlock(note.appearance)],
  ]);
  return writeSections(
    notePath(splitOwnedRef(note.ref).localId),
    front,
    blocks,
    held,
  );
}

/**
 * The file `path` holds, its front matter already written: the sections in
 * order, each opened by its own ULID, with every drawing written beside them.
 * A note and an offered change are the same shape here — `amendment.ts`.
 *
 * `within` names what a drawing's own file is named after, alongside the
 * section it is in. An offer proposes a note's sections under the note's own
 * section ULIDs, so without it an offer holding a drawing would write over the
 * drawing the note itself holds.
 */
export function writeSections(
  path: string,
  front: string,
  blocks: readonly WrittenSection[],
  held: VaultSoFar = {},
  within?: string,
): NoteFiles {
  const files = new Map<string, Uint8Array>();
  const pictures = new Map<string, PictureSize>(held.pictures);
  const emoji = new Map<string, EmojiDrawing>(held.emoji);
  const media = new Map<string, string>(held.media);
  const parts = [front];
  for (const block of blocks) {
    const ulid = splitOwnedRef(block.ref).localId;
    const sidecars: Sidecars = {
      block: within === undefined ? ulid : `${within}-${ulid}`,
      media,
      pictures,
      emoji,
      ink: new Map(),
    };
    const markdown = toMarkdown(block.content, sidecars);
    parts.push(`<!-- block ${ulid} -->`);
    if (markdown !== "") parts.push(markdown);
    for (const [stem, attrs] of sidecars.ink) {
      files.set(
        inkPath(stem),
        encodeText(`${JSON.stringify(attrs, null, 2)}\n`),
      );
      files.set(inkImagePath(stem), encodeText(inkSvg(attrs)));
    }
  }
  files.set(path, encodeText(`${parts.join("\n\n")}\n`));
  return { files, pictures, emoji };
}

/** A note's file and the sidecars its sections draw on. What is missing from
 *  the sidecars is what a reader re-derives. */
export interface NoteSource {
  /** `notes/<ulid>.md`, as the vault holds it. */
  markdown: string;
  /** A drawing's attributes, keyed by its file stem. */
  ink?: ReadonlyMap<string, Record<string, unknown>>;
  /** `.sloppy/pictures.json`. */
  pictures?: ReadonlyMap<string, PictureSize>;
  /** How each shortcode draws, from the catalog the reader is going to draw
   *  it with. */
  emoji?: ReadonlyMap<string, EmojiDrawing>;
}

/**
 * The note a file holds. Throws where it is not a note file, or where its `ref`
 * is not one; everything else a hand can get wrong costs that field and not the
 * note.
 */
export function vaultToNote(files: NoteSource): VaultNote {
  const { front, body } = splitNoteFile(files.markdown);
  const ref = OwnedRefSchema.safeParse(frontString(front, "ref"));
  if (!ref.success) {
    throw new VaultFormatError("This file isn't a note.");
  }
  const parent = OwnedRefSchema.safeParse(frontString(front, "parent"));
  const look = NodeAppearanceSchema.safeParse(frontBlock(front, "appearance"));
  const address = AddressSchema.safeParse(frontString(front, "address"));
  const owner = PrincipalSchema.safeParse(frontString(front, "owner"));
  const checked = CommitIdSchema.safeParse(frontString(front, "checked"));
  const authors = named(frontList(front, "authors"));
  const contributors = named(frontList(front, "contributors"));
  const stamp = (key: string): { [k: string]: Timestamp } => {
    const held = TimestampSchema.safeParse(frontString(front, key));
    return held.success ? { [key]: held.data } : {};
  };
  return {
    ref: ref.data,
    ...(parent.success ? { parent: parent.data } : {}),
    ...(address.success ? { address: address.data } : {}),
    aliases: frontList(front, "aliases").filter(
      (held) => AddressSchema.safeParse(held).success,
    ),
    ...(owner.success ? { owner: owner.data } : {}),
    ...(authors.length > 0 ? { authors } : {}),
    ...(contributors.length > 0 ? { contributors } : {}),
    tags: frontList(front, "tags"),
    links: refs(frontList(front, "links")),
    ...edgesRead(front),
    title: frontString(front, "title") ?? "",
    ...(look.success && !isUnstyled(look.data)
      ? { appearance: look.data }
      : {}),
    ...stamp("created"),
    ...stamp("updated"),
    ...(checked.success ? { checked: checked.data } : {}),
    sections: readSections(body, files),
  };
}

/** The references among these, as the schema spells them. */
function refs(held: readonly string[]): OwnedRef[] {
  return held.flatMap((one) => {
    const parsed = OwnedRefSchema.safeParse(one);
    return parsed.success ? [parsed.data] : [];
  });
}

/** The identifiers among these, as the schema spells them — a name a file
 *  carries in some other casing lands here in the one everything compares. */
function named(held: readonly string[]): Principal[] {
  return held.flatMap((one) => {
    const parsed = PrincipalSchema.safeParse(one);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Whose writing the note carries, where that is anything but the ref's own
 *  owner alone — the one case the file leaves out, so a note written before the
 *  list and a note only its author has written into are the same file. */
function writtenAuthors(note: NodeView): Principal[] {
  const authors = note.authors ?? [];
  const [first] = authors;
  return authors.length === 1 && first === splitOwnedRef(note.ref).owner
    ? []
    : [...authors];
}

/** The look as one block under the note's own fields. A look with every channel
 *  taken back off is not written: absent is what unstyled reads as. */
export function lookBlock(
  appearance: NodeAppearance | undefined,
): FrontBlock | undefined {
  if (appearance === undefined || isUnstyled(appearance)) return undefined;
  const channels = new Map<string, string | number | readonly string[]>();
  for (const [channel, value] of Object.entries(appearance)) {
    if (value !== undefined) channels.set(channel, value);
  }
  return channels;
}

/**
 * Each look as one entry under `edges`, its fields in one order so two writers
 * cannot spell one look two ways. A channel that says nothing is not written,
 * and neither is a look that says nothing at all.
 */
export function edgeEntries(
  edges: readonly EdgeLook[] | undefined,
): FrontEntries | undefined {
  return looksWritten(edges)?.map(lookFields);
}

function lookFields(look: EdgeLook): FrontBlock {
  const fields = new Map<string, string>([["to", look.to]]);
  if (look.label !== undefined) fields.set("label", look.label);
  if (look.direction !== undefined) fields.set("direction", look.direction);
  if (look.stroke !== undefined) fields.set("stroke", look.stroke);
  return fields;
}

/** The looks a file holds. One a hand got wrong costs that look and not the
 *  note, the way a field a hand got wrong costs that field. */
export function edgesRead(
  front: ReadonlyMap<string, FrontValue>,
): Pick<VaultNote, "edges"> {
  const edges = looksRead(
    frontEntries(front, "edges").flatMap((entry) => {
      const look = EdgeLookSchema.safeParse(entry);
      return look.success ? [look.data] : [];
    }),
  );
  return edges.length === 0 ? {} : { edges };
}

/** The sections a body holds, read back against the sidecars they draw on. */
export function readSections(
  body: readonly string[],
  files: NoteSource,
): VaultSection[] {
  const sections: VaultSection[] = [];
  let ulid: string | null = null;
  let lines: string[] = [];
  const close = (): void => {
    if (ulid === null) return;
    const sidecars = emptySidecars(ulid);
    if (files.ink)
      for (const [stem, attrs] of files.ink) sidecars.ink.set(stem, attrs);
    if (files.pictures) {
      for (const [upload, size] of files.pictures) {
        sidecars.pictures.set(upload, size);
      }
    }
    if (files.emoji) {
      for (const [name, drawing] of files.emoji)
        sidecars.emoji.set(name, drawing);
    }
    sections.push({
      ulid,
      content: fromMarkdown(trimmed(lines).join("\n"), sidecars),
    });
  };
  for (const line of body) {
    const opened = SECTION_OPENER.exec(line);
    if (!opened || !UlidSchema.safeParse(opened[1]).success) {
      if (ulid !== null) lines.push(line);
      continue;
    }
    close();
    ulid = opened[1];
    lines = [];
  }
  close();
  return sections;
}

function trimmed(lines: readonly string[]): string[] {
  let from = 0;
  let to = lines.length;
  while (from < to && lines[from] === "") from++;
  while (to > from && lines[to - 1] === "") to--;
  return lines.slice(from, to);
}
