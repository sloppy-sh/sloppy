/**
 * Sloppy's own acts, done against a project's container and answered to the
 * agent that called them — docs/ARCHITECTURE.md § "Asking a tool to write the
 * notes" and § "An assistant outside the app". The app's chat and `sloppy mcp`
 * both call {@link performChatCall}, so a rule about a note is one rule however
 * an agent came in. The writer is the container's own identity, and every write
 * onto a standing note goes through `writeOnto`.
 *
 * What an answer RUNS TO is `listingAnswer`'s, `foundAnswer`'s and
 * `noteAnswer`'s in `@sloppy/types`, so nothing here decides how much of a
 * project one call carries.
 */

import {
  type AmendmentView,
  anchorsOf,
  aroundAnswer,
  binAnswer,
  type BinnedNote,
  type BlockDocument,
  type BriefArguments,
  briefAnswer,
  type ChatToolAnswer,
  type ChatToolCall,
  CODE_SCHEME,
  type DeletedBranch,
  type DeleteNoteArguments,
  type EdgeLook,
  type FoundNote,
  foundAnswer,
  type GraphRead,
  GraphReadSchema,
  type LinkNotesArguments,
  type ListedOffer,
  type ListedTag,
  listingAnswer,
  lookBetween,
  MOST_NOTES_TOUCHED,
  type MoveNoteArguments,
  type NodeAppearance,
  type NodeView,
  noteAnswer,
  type NoteBinned,
  type NoteWritten,
  type NumberNoteArguments,
  OFFER_SUMMARY_MAX,
  offersAnswer,
  type OwnedRef,
  type ReadAroundArguments,
  type RestoreNoteArguments,
  type SearchHit,
  splitOwnedRef,
  type StyleEdgeArguments,
  type StyleNoteArguments,
  type Tag,
  type TagNoteArguments,
  tagsAmong,
  tagsAnswer,
  ulid,
  type WriteDone,
  type WriteNoteArguments,
} from "@sloppy/types";
import {
  emptySidecars,
  fromMarkdown,
  GRAPH_FILE,
  readGraphFile,
  type VaultGraph,
} from "@sloppy/vault";
import { LocalApi } from "./api.js";
import { aroundOf, briefOf, codeHere, noteRead } from "./brief.js";
import { containerDataAt, containerOf } from "./container.js";
import { type Files, keepingDataAt } from "./files.js";
import { LocalGraph } from "./graph.js";
import {
  asListed,
  type NoteHere,
  notesHere,
  pathsIn,
  reaches,
} from "./here.js";
import { refusalWords } from "./refusal.js";
import { writeOnto } from "./write-onto.js";

const NO_NOTE =
  "There is no note here with that ref. List the notes and read one of those.";
const NOTHING_WRITTEN = "That write named no sections, so nothing was written.";
const NO_PARENT =
  "There is no note here to write that one under. List the notes and name one of those.";
const NOT_WRITTEN = "That note was not written.";
const NOT_CARRIED = "That note was not carried anywhere.";
const NOTHING_TAGGED = "That named no tags to put on and none to take off.";
const NOT_NUMBERED = "That note was not numbered.";
const NOTHING_LINKED = "That named no lines to draw and none to take off.";
const NO_OTHER_NOTE =
  "There is no note here at the other end of that line. List the notes and name one of those.";
const NOT_TO_ITSELF =
  "A note draws no line to itself. Name the note at the other end.";
const NOT_LINKED = "Those lines were left as they were.";
const NOTHING_DRAWN = "That named nothing to draw and nothing to take off.";
const NOT_LOOKED = "That line was left as it was.";
const NOT_DRAWN = "That mark was left as it was.";
const NOT_LISTED = "The bin could not be read.";
const NOT_RESTORED = "That note was not taken out of the bin.";
const NO_GRAPH = "There is no graph here to read.";
const NOTHING_ASKED =
  "That names nothing to brief on. Name notes, places or words.";

function severalReach(about: string, notes: readonly NodeView[]): string {
  const named = notes
    .map(
      (note) =>
        `"${note.title}" (${note.ref}${note.address === undefined ? "" : `, at ${note.address}`})`,
    )
    .join("; ");
  return `Several notes here reach ${about} and none was started about it: ${named}. Cite the one you mean in what you write, or write about a narrower place.`;
}

/**
 * Why an act came to nothing, where the agent's words for it carry a sentence
 * telling it what to call next that a person reading the thread has no use
 * for, and a listing or a note longer than one answer holds. Trouble with no
 * reason named is one sentence for both readers.
 */
export const ACT_REFUSALS = [
  "no_note",
  "no_other_note",
  "no_parent",
  "nothing_written",
  "nothing_tagged",
  "nothing_linked",
  "nothing_drawn",
  "not_to_itself",
  "no_graph",
  "nothing_asked",
  "too_much",
] as const;
export type ActRefusal = (typeof ACT_REFUSALS)[number];

/** What an act came to that whoever shows it to a person lays out, by act.
 *  A note named here is as the act left it. */
export type ActFacts =
  | {
      act:
        | "list_notes"
        | "search_notes"
        | "list_tags"
        | "list_bin"
        | "list_offers";
      count: number;
    }
  | { act: "read_note" | "number_note" | "style_note"; note: NodeView }
  | {
      act: "write_note";
      done: WriteDone;
      /** Absent where the note could not be read back once written. */
      note?: NodeView;
      /** The note it hangs under, as it stood before the write. */
      under?: NodeView;
    }
  | {
      act: "move_note";
      note: NodeView;
      /** Absent where the note it was carried to could not be read. */
      to?: NodeView;
      /** How many notes went with it. */
      beneath: number;
    }
  | { act: "tag_note"; note: NodeView; on: Tag[]; off: Tag[] }
  | {
      act: "link_notes";
      note: NodeView;
      /** The notes at the other end of the lines drawn and taken off, less
       *  any that are not here. */
      to: NodeView[];
      off: NodeView[];
    }
  | { act: "style_edge"; note: NodeView; other: NodeView }
  | {
      act: "delete_note" | "restore_note";
      note: NodeView;
      /** The places in the code it is about. */
      about: string[];
      beneath: number;
    }
  | { act: "read_graph"; name: string }
  | {
      act: "read_around";
      note: NodeView;
      /** How many notes around it the answer carries. */
      count: number;
    }
  | {
      act: "brief";
      /** How many notes the brief carries whole. */
      count: number;
      /** How many it carries as one line. */
      around: number;
    };

/**
 * One act, done. `said` and `trouble` are the agent's and are all an agent is
 * ever handed; the rest is for a surface showing the act to a person.
 */
export interface ActAnswer extends ChatToolAnswer {
  /** The notes this left different from how it found them. **Absent is an act
   *  that did not say**, and everything is read again; an EMPTY list is one
   *  that changed nothing. */
  touched?: OwnedRef[];
  /** Absent on trouble. */
  facts?: ActFacts;
  /** Absent on an answer, and on trouble one sentence says for both readers. */
  refused?: ActRefusal;
}

/** A store over the notes for the project `files` is rooted at, writing as the
 *  container rather than as whoever is signed in here. */
export function containerApi(files: Files): LocalApi {
  return new LocalApi(keepingDataAt(files, containerDataAt(files.root)));
}

/**
 * A store over the notes a PLACE already holds: a folder beside the project
 * that a thread reads. A folder holding none is said rather than made into a
 * graph, and every act that would write refuses.
 */
export function placeApi(files: Files): LocalApi {
  return new LocalApi(keepingDataAt(files, containerDataAt(files.root)), {
    reading: true,
  });
}

/**
 * One of Sloppy's own acts, done against the project `files` is rooted at. The
 * arguments arrived parsed. `reading` is a folder served by {@link placeApi},
 * so nothing an act does there lands.
 */
export async function performChatCall(
  files: Files,
  call: ChatToolCall,
  reading = false,
): Promise<ActAnswer> {
  const api = reading ? placeApi(files) : containerApi(files);
  switch (call.act) {
    case "list_notes": {
      const { about, tags = [] } = call.arguments;
      const here = (await notesHere(api)).filter(
        (held) =>
          (about === undefined || reaches(held.about, about)) &&
          tags.every((tag) => held.note.tags.includes(tag)),
      );
      const answer = listingAnswer(
        here.map((held) => asListed(held.note, held.about)),
      );
      return counted(answer, "list_notes", here.length);
    }
    case "search_notes": {
      const hits = (await api.searchNotes(call.arguments.words)).map(asFound);
      return counted(foundAnswer(hits), "search_notes", hits.length);
    }
    case "read_note":
      return await readNote(api, call.arguments.note);
    case "write_note":
      return await writeNote(api, call.arguments);
    case "move_note":
      return await moveNote(api, call.arguments);
    case "tag_note":
      return await tagNote(api, call.arguments);
    case "number_note":
      return await numberNote(api, call.arguments);
    case "link_notes":
      return await linkNotes(api, call.arguments);
    case "style_edge":
      return await styleEdge(api, call.arguments);
    case "style_note":
      return await styleNote(api, call.arguments);
    case "delete_note":
      return await deleteNote(api, call.arguments);
    case "list_tags":
      return await listTags(api);
    case "list_bin":
      return await listBin(api, reading);
    case "restore_note":
      return await restoreNote(api, call.arguments);
    case "list_offers":
      return await listOffers(api, call.arguments.note);
    case "read_graph":
      return await readGraph(api, files);
    case "read_around":
      return await readAround(api, call.arguments);
    case "brief":
      return await brief(api, call.arguments);
  }
}

/** A listing, answered with how many it held where it held them all. */
function counted(
  answer: ChatToolAnswer,
  act: "list_notes" | "search_notes" | "list_tags" | "list_bin" | "list_offers",
  count: number,
): ActAnswer {
  return answer.trouble
    ? { ...answer, refused: "too_much", touched: [] }
    : { ...answer, facts: { act, count }, touched: [] };
}

async function listTags(api: LocalApi): Promise<ActAnswer> {
  const tags: ListedTag[] = (await api.listTags()).map(({ tag, notes }) => ({
    tag,
    notes,
  }));
  return counted(tagsAnswer(tags), "list_tags", tags.length);
}

/** What is in the bin of the graph here, latest first. */
async function listBin(api: LocalApi, reading: boolean): Promise<ActAnswer> {
  try {
    const graph = await api.graphHere();
    const branches = reading
      ? await binReadIn(api.files)
      : await api.deletedBranches();
    const bin = branches
      .filter((branch) => reading || branch.graph === graph)
      .map(asBinned);
    return counted(binAnswer(bin), "list_bin", bin.length);
  } catch (error) {
    return { ...troubleWriting(error, NOT_LISTED), touched: [] };
  }
}

/** The bin of the one graph a folder holds, read as it stands: clearing out
 *  what has been there too long is a write, and a folder only read is never
 *  written. */
async function binReadIn(files: Files): Promise<DeletedBranch[]> {
  const vault =
    (await containerOf(files)) ??
    ((await files.exists(GRAPH_FILE)) ? files : undefined);
  if (!vault) return [];
  return (await LocalGraph.read(vault))
    .deletedBranches()
    .sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
}

function asBinned(branch: DeletedBranch): BinnedNote {
  return {
    note: branch.ref,
    title: branch.title,
    ...(branch.address === undefined ? {} : { address: branch.address }),
    binned_at: branch.deleted_at,
    beneath: branch.notes - 1,
  };
}

/** A note taken back out of the bin, by the rule `restore` in the store holds
 *  that to. */
async function restoreNote(
  api: LocalApi,
  asked: RestoreNoteArguments,
): Promise<ActAnswer> {
  try {
    const restored = await api.restoreBranch(asked.note);
    const going = beneath(await notesHere(api), restored.ref);
    const about = await anchorsIn(api, restored.ref);
    return {
      said: JSON.stringify(asListed(restored, about)),
      facts: {
        act: "restore_note",
        note: restored,
        about,
        beneath: going.length,
      },
      ...touchedBy([restored.ref, ...going.map((one) => one.ref)]),
    };
  } catch (error) {
    return troubleWriting(error, NOT_RESTORED);
  }
}

async function listOffers(api: LocalApi, ref: OwnedRef): Promise<ActAnswer> {
  if (!(await api.getNode(ref))) return trouble(NO_NOTE, "no_note");
  const offers = (await api.listAmendments(ref)).map(asOffered);
  return counted(offersAnswer(offers), "list_offers", offers.length);
}

function asOffered(offer: AmendmentView): ListedOffer {
  return {
    offer: offer.ref,
    by: offer.by,
    at: offer.at,
    summary: offerSummary(offer),
  };
}

/** The first line of what the offer says of itself, or else the title it
 *  proposes. */
function offerSummary(offer: AmendmentView): string {
  const line =
    (offer.message ?? "").trim().split("\n")[0].trim() || offer.title.trim();
  return line.length <= OFFER_SUMMARY_MAX
    ? line
    : `${line.slice(0, OFFER_SUMMARY_MAX - 1)}…`;
}

/** What the graph here is. Who its owner says they are and where its code is
 *  are read off the graph's own file, and left out where it says nothing. */
async function readGraph(api: LocalApi, files: Files): Promise<ActAnswer> {
  try {
    const ref = await api.graphHere();
    const view = (await api.listGraphs()).find((graph) => graph.ref === ref);
    if (!view) return trouble(NO_GRAPH, "no_graph");
    const { owner, localId } = splitOwnedRef(ref);
    const said = await graphFileIn(files, localId);
    const read: GraphRead = {
      name: view.title,
      owner,
      ...(said?.owner_name === undefined
        ? {}
        : { owner_name: said.owner_name }),
      ownership: view.ownership ?? "open",
      ...(said?.project === undefined ? {} : { project: said.project }),
    };
    const answer = GraphReadSchema.safeParse(read);
    if (!answer.success) return trouble(NO_GRAPH, "no_graph");
    return {
      said: JSON.stringify(answer.data),
      facts: { act: "read_graph", name: view.title },
      touched: [],
    };
  } catch (error) {
    return { ...troubleWriting(error, NO_GRAPH, "no_graph"), touched: [] };
  }
}

/** The graph file of the container in `files`, where it is the file of the
 *  graph `localId` names. */
async function graphFileIn(
  files: Files,
  localId: string,
): Promise<VaultGraph | undefined> {
  const vault = await containerOf(files);
  const bytes = vault && (await vault.read(GRAPH_FILE));
  if (!bytes) return undefined;
  try {
    const said = readGraphFile(bytes);
    return said.graph === localId ? said : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The note a write about `about` lands on: the one started about it, else the
 * one note reaching it, else none. Several reaching it and none started about
 * it is the list of them, which nothing can choose between.
 */
function noteToWrite(
  here: readonly NoteHere[],
  about: string,
): NodeView | NodeView[] | undefined {
  const started = here.find((held) => held.startedAbout === about);
  if (started) return started.note;
  const reaching = here.filter((held) => held.about.includes(about));
  if (reaching.length > 1) return reaching.map((held) => held.note);
  return reaching[0]?.note;
}

/** One note as an act that wrote on it answers the agent with. */
async function listedSaid(api: LocalApi, note: NodeView): Promise<string> {
  return JSON.stringify(asListed(note, await anchorsIn(api, note.ref)));
}

function asFound(hit: SearchHit): FoundNote {
  return {
    note: hit.note,
    title: hit.title,
    ...(hit.address === undefined ? {} : { address: hit.address }),
    snippet: hit.snippet,
  };
}

async function readNote(api: LocalApi, ref: OwnedRef): Promise<ActAnswer> {
  const note = await api.getNode(ref);
  if (!note) return trouble(NO_NOTE, "no_note");
  const blocks = await api.listBlocks(note.ref);
  const { sections, ...rest } = await noteRead(
    note,
    blocks,
    pathsIn(blocks.map((block) => block.content)),
    await codeHere(api),
  );
  const answer = noteAnswer(rest, sections);
  return answer.trouble
    ? { ...answer, refused: "too_much", touched: [] }
    : { ...answer, facts: { act: "read_note", note }, touched: [] };
}

async function readAround(
  api: LocalApi,
  asked: ReadAroundArguments,
): Promise<ActAnswer> {
  const read = await aroundOf(api, asked.note, asked.depth);
  if (!read) return trouble(NO_NOTE, "no_note");
  const answer = aroundAnswer(read.whole, read.around);
  if (answer.trouble) return { ...answer, refused: "too_much", touched: [] };
  const { around } = JSON.parse(answer.said) as { around: unknown[] };
  return {
    ...answer,
    facts: { act: "read_around", note: read.note, count: around.length },
    touched: [],
  };
}

async function brief(api: LocalApi, asked: BriefArguments): Promise<ActAnswer> {
  if (
    (asked.notes ?? []).length === 0 &&
    (asked.about ?? []).length === 0 &&
    asked.words === undefined
  ) {
    return trouble(NOTHING_ASKED, "nothing_asked");
  }
  const read = await briefOf(api, asked);
  if ("missing" in read) return trouble(NO_NOTE, "no_note");
  const answer = briefAnswer(read.asked, read.around, asked.budget);
  if (answer.trouble) return { ...answer, refused: "too_much", touched: [] };
  const { notes, around } = JSON.parse(answer.said) as {
    notes: unknown[];
    around: unknown[];
  };
  return {
    ...answer,
    facts: { act: "brief", count: notes.length, around: around.length },
    touched: [],
  };
}

async function writeNote(
  api: LocalApi,
  asked: WriteNoteArguments,
): Promise<ActAnswer> {
  if (asked.sections.length === 0) {
    return trouble(NOTHING_WRITTEN, "nothing_written");
  }
  const here = await notesHere(api);
  const target = noteToWrite(here, asked.about);
  if (Array.isArray(target)) return trouble(severalReach(asked.about, target));
  const standing = target;
  if (
    !standing &&
    asked.under !== undefined &&
    !(await api.getNode(asked.under))
  ) {
    return trouble(NO_PARENT, "no_parent");
  }
  const tags = tagsAmong(asked.tags ?? []);
  const aside = emptySidecars(
    standing === undefined ? ulid() : splitOwnedRef(standing.ref).localId,
  );
  const sections = asked.sections.map((markdown) =>
    fromMarkdown(markdown, aside),
  );
  try {
    // Before the writing, so that a number the graph refuses leaves the note
    // as it was rather than written at the number it already had.
    if (standing && asked.address !== undefined) {
      await api.setAddress(standing.ref, asked.address);
    }
    const written: NoteWritten = standing
      ? {
          note: standing.ref,
          done: (await writeOnto(api, standing, sections, tags)).done,
        }
      : {
          note: await startNote(api, here, asked, sections, tags),
          done: "written",
        };
    const note = (await api.getNode(written.note)) ?? undefined;
    const under = here.find(
      (held) => note?.parent !== undefined && held.note.ref === note.parent,
    )?.note;
    return {
      said: JSON.stringify(written),
      facts: {
        act: "write_note",
        done: written.done,
        ...(note === undefined ? {} : { note }),
        ...(under === undefined ? {} : { under }),
      },
      touched: [written.note],
    };
  } catch (error) {
    return troubleWriting(error, NOT_WRITTEN);
  }
}

/**
 * A note this project has none of yet. Where the agent named nothing to write
 * it under, it hangs under the note about the nearest folder above it, and
 * otherwise under whatever the notes about this code already hang under —
 * docs/ARCHITECTURE.md § "Tooling" is the shape it joins.
 */
async function startNote(
  api: LocalApi,
  here: readonly NoteHere[],
  asked: WriteNoteArguments,
  sections: readonly BlockDocument[],
  tags: readonly Tag[],
): Promise<OwnedRef> {
  const { about, title } = asked;
  const under = asked.under ?? noteOver(here, about) ?? branchOf(here);
  const note = await api.createNode({
    // Nothing to spring from opens a branch, so the rule numbers it and
    // everything written beneath it after.
    from:
      under === undefined
        ? { relation: "branch" }
        : { relation: "under", note: under },
    title: title ?? about,
    tags: [...tags],
    ...(asked.address === undefined ? {} : { address: asked.address }),
  });
  let after: OwnedRef | undefined;
  for (const content of bodyAbout(about, sections)) {
    const block = await api.createBlock({
      node: note.ref,
      content,
      ...(after === undefined ? {} : { after }),
    });
    after = block.ref;
  }
  return note.ref;
}

/** A note started about a place opens with an anchor to it where its sections
 *  reach it nowhere: the places a note is about are read back off its anchors
 *  and off nothing else, so one carrying none is about nowhere. */
function bodyAbout(
  about: string,
  sections: readonly BlockDocument[],
): BlockDocument[] {
  const reaches = sections.some((content) =>
    anchorsOf(content).some((anchor) => anchor.path === about),
  );
  return reaches ? [...sections] : [pointingAt(about), ...sections];
}

function pointingAt(about: string): BlockDocument {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: about,
            marks: [
              { type: "link", attrs: { href: `${CODE_SCHEME}${about}` } },
            ],
          },
        ],
      },
    ],
  };
}

/** A note carried somewhere else, by the rule `moveNote` in the store holds a
 *  move to. */
async function moveNote(
  api: LocalApi,
  asked: MoveNoteArguments,
): Promise<ActAnswer> {
  if (!(await api.getNode(asked.note))) return trouble(NO_NOTE, "no_note");
  const to = (await api.getNode(asked.to)) ?? undefined;
  try {
    const carried = await api.moveNote(
      asked.note,
      { relation: asked.relation, note: asked.to },
      asked.address,
    );
    const moved = carried.find((one) => one.ref === asked.note);
    if (!moved) return trouble(NOT_CARRIED);
    return {
      said: await listedSaid(api, moved),
      facts: {
        act: "move_note",
        note: moved,
        ...(to === undefined ? {} : { to }),
        beneath: carried.length - 1,
      },
      ...touchedBy(carried.map((one) => one.ref)),
    };
  } catch (error) {
    return troubleWriting(error, NOT_CARRIED);
  }
}

/** A tag named both to put on and to take off comes off. */
async function tagNote(
  api: LocalApi,
  asked: TagNoteArguments,
): Promise<ActAnswer> {
  const on = tagsAmong(asked.tags ?? []);
  const off = tagsAmong(asked.off ?? []);
  if (on.length === 0 && off.length === 0) {
    return trouble(NOTHING_TAGGED, "nothing_tagged");
  }
  const note = await api.getNode(asked.note);
  if (!note) return trouble(NO_NOTE, "no_note");
  const gone = new Set<string>(off);
  const tags = [...new Set([...note.tags, ...on])].filter(
    (tag) => !gone.has(tag),
  );
  const written = await api.updateNode(asked.note, { tags });
  return {
    said: await listedSaid(api, written),
    facts: { act: "tag_note", note: written, on, off },
    touched: [written.ref],
  };
}

/** The label a person cites a note by, written or taken off. Every rule it is
 *  held to — unique in its graph, springing from the note above, the number it
 *  leaves still leading to it — is `setAddress` in the store, which refuses in
 *  words the agent is handed. */
async function numberNote(
  api: LocalApi,
  asked: NumberNoteArguments,
): Promise<ActAnswer> {
  if (!(await api.getNode(asked.note))) return trouble(NO_NOTE, "no_note");
  try {
    const written = await api.setAddress(asked.note, asked.address ?? null);
    return {
      said: await listedSaid(api, written),
      facts: { act: "number_note", note: written },
      touched: [written.ref],
    };
  } catch (error) {
    return troubleWriting(error, NOT_NUMBERED);
  }
}

/** A note named both to draw a line to and to take one off loses its line. */
async function linkNotes(
  api: LocalApi,
  asked: LinkNotesArguments,
): Promise<ActAnswer> {
  const off = new Set<OwnedRef>(asked.off ?? []);
  const to = [...new Set(asked.to ?? [])].filter((one) => !off.has(one));
  if (to.length === 0 && off.size === 0) {
    return trouble(NOTHING_LINKED, "nothing_linked");
  }
  const note = await api.getNode(asked.note);
  if (!note) return trouble(NO_NOTE, "no_note");
  if (to.includes(asked.note)) return trouble(NOT_TO_ITSELF, "not_to_itself");
  for (const other of to) {
    if (!(await api.getNode(other))) {
      return trouble(NO_OTHER_NOTE, "no_other_note");
    }
  }
  const links = [...new Set([...note.links, ...to])].filter(
    (one) => !off.has(one),
  );
  try {
    const written = await api.updateNode(asked.note, { links });
    return {
      said: await listedSaid(api, written),
      facts: {
        act: "link_notes",
        note: written,
        to: await notesNamed(api, to),
        off: await notesNamed(api, [...off]),
      },
      touched: [written.ref],
    };
  } catch (error) {
    return troubleWriting(error, NOT_LINKED);
  }
}

/** The notes some refs name, less any that are not here. */
async function notesNamed(
  api: LocalApi,
  refs: readonly OwnedRef[],
): Promise<NodeView[]> {
  const held: NodeView[] = [];
  for (const ref of refs) {
    const note = await api.getNode(ref);
    if (note) held.push(note);
  }
  return held;
}

/**
 * The look on one line. It is written on the end already carrying the pair's
 * look, so one line keeps one — and the arrowhead is read against the note it
 * is written on, so it turns with it.
 */
async function styleEdge(
  api: LocalApi,
  asked: StyleEdgeArguments,
): Promise<ActAnswer> {
  if (asked.to === asked.note) return trouble(NOT_TO_ITSELF, "not_to_itself");
  if (!saysAnything([asked.label, asked.direction, asked.stroke], asked.off)) {
    return trouble(NOTHING_DRAWN, "nothing_drawn");
  }
  const note = await api.getNode(asked.note);
  if (!note) return trouble(NO_NOTE, "no_note");
  const other = await api.getNode(asked.to);
  if (!other) return trouble(NO_OTHER_NOTE, "no_other_note");
  const won = lookBetween(note, other);
  const on = won !== undefined && won.to === note.ref ? other : note;
  const at = on === note ? other : note;
  const look = lookAsked(won, asked, at.ref, on !== note);
  const edges = [...(on.edges ?? []).filter((one) => one.to !== at.ref), look];
  try {
    const written = await api.updateNode(on.ref, { edges });
    return {
      said: await listedSaid(api, written),
      facts: { act: "style_edge", note, other },
      touched: [written.ref],
    };
  } catch (error) {
    return troubleWriting(error, NOT_LOOKED);
  }
}

/** Whether a look act names anything at all — a channel to set, or one to take
 *  back off. */
function saysAnything(
  channels: readonly unknown[],
  off: readonly unknown[] | undefined,
): boolean {
  return channels.some((said) => said !== undefined) || (off ?? []).length > 0;
}

/** Which end an arrowhead sits at, read from the other end of the same line. */
function facing(direction: EdgeLook["direction"]): EdgeLook["direction"] {
  if (direction === "to") return "from";
  return direction === "from" ? "to" : direction;
}

/** The look the line is left with: what it already reads as, what this act
 *  says, and the channels it takes back off. */
function lookAsked(
  held: EdgeLook | undefined,
  asked: StyleEdgeArguments,
  to: OwnedRef,
  turned: boolean,
): EdgeLook {
  const off = new Set<string>(asked.off ?? []);
  const kept = <T>(
    channel: string,
    said: T | undefined,
    was: T | undefined,
  ): T | undefined => (off.has(channel) ? undefined : (said ?? was));
  const label = kept("label", asked.label, held?.label);
  const direction = kept(
    "direction",
    turned ? facing(asked.direction) : asked.direction,
    held?.direction,
  );
  const stroke = kept("stroke", asked.stroke, held?.stroke);
  return {
    to,
    ...(label === undefined ? {} : { label }),
    ...(direction === undefined ? {} : { direction }),
    ...(stroke === undefined ? {} : { stroke }),
  };
}

/** How a note's mark is drawn. A look with nothing left set leaves the note
 *  unstyled, which `lookWritten` in the store is what recognises. */
async function styleNote(
  api: LocalApi,
  asked: StyleNoteArguments,
): Promise<ActAnswer> {
  const named = [asked.ring_weight, asked.ring_style, asked.mark_radius];
  if (!saysAnything(named, asked.off)) {
    return trouble(NOTHING_DRAWN, "nothing_drawn");
  }
  const note = await api.getNode(asked.note);
  if (!note) return trouble(NO_NOTE, "no_note");
  const appearance = markAsked(note.appearance, asked);
  try {
    const written = await api.updateNode(asked.note, { appearance });
    return {
      said: await listedSaid(api, written),
      facts: { act: "style_note", note: written },
      touched: [written.ref],
    };
  } catch (error) {
    return troubleWriting(error, NOT_DRAWN);
  }
}

/** The channels this act writes, taken off what the note carries so that what
 *  it leaves out is left out rather than written twice. */
const MARK_SHAPE = [
  "ring_weight",
  "ring_style",
  "mark_radius",
  "mark_scale",
] as const;

function markAsked(
  held: NodeAppearance | undefined,
  asked: StyleNoteArguments,
): NodeAppearance {
  const off = new Set<string>(asked.off ?? []);
  const kept = <T>(
    channel: string,
    said: T | undefined,
    was: T | undefined,
  ): T | undefined => (off.has(channel) ? undefined : (said ?? was));
  const weight = kept("ring_weight", asked.ring_weight, held?.ring_weight);
  const style = kept("ring_style", asked.ring_style, held?.ring_style);
  const radius = kept("mark_radius", asked.mark_radius, held?.mark_radius);
  // A step and a fine size say one size two ways and the fine one is what
  // draws, so a step named here takes it off.
  const sized = asked.mark_radius !== undefined || off.has("mark_radius");
  const scale = sized ? undefined : held?.mark_scale;
  const pictures: NodeAppearance = { ...held };
  for (const channel of MARK_SHAPE) delete pictures[channel];
  return {
    ...pictures,
    ...(weight === undefined ? {} : { ring_weight: weight }),
    ...(style === undefined ? {} : { ring_style: style }),
    ...(radius === undefined ? {} : { mark_radius: radius }),
    ...(scale === undefined ? {} : { mark_scale: scale }),
  };
}

async function deleteNote(
  api: LocalApi,
  asked: DeleteNoteArguments,
): Promise<ActAnswer> {
  const note = await api.getNode(asked.note);
  if (!note) return trouble(NO_NOTE, "no_note");
  const going = beneath(await notesHere(api), note.ref);
  const about = await anchorsIn(api, note.ref);
  const binned = asListed(note, about);
  try {
    await api.deleteNode(asked.note);
  } catch (error) {
    return troubleWriting(error, NO_NOTE, "no_note");
  }
  return {
    said: JSON.stringify({ binned } satisfies NoteBinned),
    facts: { act: "delete_note", note, about, beneath: going.length },
    ...touchedBy([note.ref, ...going.map((one) => one.ref)]),
  };
}

/** The note about the nearest folder above `path`, and nothing where no note
 *  reaches that far. */
function noteOver(
  here: readonly NoteHere[],
  path: string,
): OwnedRef | undefined {
  let over: { note: OwnedRef; at: string } | undefined;
  for (const held of here) {
    for (const at of held.about) {
      if (!path.startsWith(`${at}/`)) continue;
      if (over === undefined || at.length > over.at.length) {
        over = { note: held.note.ref, at };
      }
    }
  }
  return over?.note;
}

/** What the notes about this project's code hang under. Absent where nothing
 *  here points at code, and where two branches do, which nothing can choose
 *  between. */
function branchOf(here: readonly NoteHere[]): OwnedRef | undefined {
  const origins = new Set(
    here
      .filter((held) => held.about.length > 0)
      .map((held) => held.note.origin),
  );
  const [only] = origins;
  return origins.size === 1 ? only : undefined;
}

async function anchorsIn(api: LocalApi, note: OwnedRef): Promise<string[]> {
  return pathsIn((await api.listBlocks(note)).map((block) => block.content));
}

/** Every note under `ref`, which a move carries with it and a delete takes. */
function beneath(here: readonly NoteHere[], ref: OwnedRef): NodeView[] {
  const under = new Map<OwnedRef, NodeView[]>();
  for (const held of here) {
    const parent = held.note.parent;
    if (parent === undefined) continue;
    under.set(parent, [...(under.get(parent) ?? []), held.note]);
  }
  const going = new Map<OwnedRef, NodeView>();
  const walk = (of: OwnedRef): void => {
    for (const child of under.get(of) ?? []) {
      if (going.has(child.ref)) continue;
      going.set(child.ref, child);
      walk(child.ref);
    }
  };
  walk(ref);
  return [...going.values()];
}

/**
 * The notes an act left different, where it can name them all. Past the bound
 * it names none and the whole folder is read again, which is the cheaper truth
 * for a move or a delete that carried a subtree that big.
 */
function touchedBy(refs: readonly OwnedRef[]): { touched?: OwnedRef[] } {
  return refs.length > MOST_NOTES_TOUCHED ? {} : { touched: [...refs] };
}

/** What an act came to that the agent asked for and did not get. Nothing was
 *  written. */
function trouble(said: string, refused?: ActRefusal): ActAnswer {
  return {
    said,
    trouble: true,
    ...(refused === undefined ? {} : { refused }),
    touched: [],
  };
}

/** Trouble a write threw, which may have left something behind — so nothing is
 *  named and everything is read again. The store refuses in words meant for a
 *  person, and the agent is handed those; where it threw nothing in words, it
 *  is handed `otherwise`. */
function troubleWriting(
  error: unknown,
  otherwise: string,
  refused?: ActRefusal,
): ActAnswer {
  const said = refusalWords(error);
  if (said !== undefined) return { said, trouble: true };
  return {
    said: otherwise,
    trouble: true,
    ...(refused === undefined ? {} : { refused }),
  };
}
