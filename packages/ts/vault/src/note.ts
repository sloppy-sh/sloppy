// One note as one file, and back — docs/ARCHITECTURE.md § "A graph on disk".

import {
  type Address,
  AddressSchema,
  type BlockDocument,
  type BlockView,
  type NodeView,
  type OwnedRef,
  OwnedRefSchema,
  splitOwnedRef,
  type Timestamp,
  TimestampSchema,
  UlidSchema,
} from "@sloppy/types";
import { frontList, frontString, splitNoteFile, writeFront } from "./front.js";
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

/** A note as a vault carries it. Everything a reader re-derives — the depth,
 *  the origin, the notes this one's writing names — is not here. */
export interface VaultNote {
  ref: OwnedRef;
  /** Absent on a branch and on an independent note. */
  parent?: OwnedRef;
  /** Absent on a note with none. */
  address?: Address;
  aliases: Address[];
  tags: string[];
  links: OwnedRef[];
  title: string;
  /** Absent where the file did not say, which is a file a hand has been in. */
  created?: Timestamp;
  updated?: Timestamp;
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
  const files = new Map<string, Uint8Array>();
  const pictures = new Map<string, PictureSize>(held.pictures);
  const emoji = new Map<string, EmojiDrawing>(held.emoji);
  const media = new Map<string, string>(held.media);
  const parts = [
    writeFront([
      ["ref", note.ref],
      ["parent", note.parent],
      ["address", note.address],
      ["aliases", [...aliases]],
      ["tags", [...note.tags]],
      ["links", [...note.links]],
      ["title", note.title],
      ["created", note.created_at],
      ["updated", note.updated_at],
    ]),
  ];
  for (const block of blocks) {
    const ulid = splitOwnedRef(block.ref).localId;
    const sidecars: Sidecars = {
      block: ulid,
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
  files.set(
    notePath(splitOwnedRef(note.ref).localId),
    encodeText(`${parts.join("\n\n")}\n`),
  );
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
  const address = AddressSchema.safeParse(frontString(front, "address"));
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
    tags: frontList(front, "tags"),
    links: frontList(front, "links").filter(
      (held) => OwnedRefSchema.safeParse(held).success,
    ),
    title: frontString(front, "title") ?? "",
    ...stamp("created"),
    ...stamp("updated"),
    sections: readSections(body, files),
  };
}

function readSections(
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
