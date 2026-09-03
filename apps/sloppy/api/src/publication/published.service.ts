// What a peer's instance reads off this one, a page at a time and without a
// session. docs/ARCHITECTURE.md § "Federating the graph".

import { Injectable } from "@nestjs/common";
import {
  type Address,
  type DidSyr,
  MAX_PUBLISHED_CHANGES_PER_PAGE,
  type OwnedRef,
  ownedRefFrom,
  type Publication,
  type PublicationVersion,
  type PublishedBlock,
  type PublishedChangesPage,
  type PublishedIndex,
  type PublishedNode,
  type PublishedNoteChange,
  type PublishedPublication,
  type PublishedSubtreePage,
  type PublishedVersionsPage,
  type SnapshotBlock,
  type SnapshotNode,
} from "@sloppy/types";
import { markPage, type PageMark, pageMark } from "./cursor";
import { comparableTo, noteChanges, type SnapshotSide } from "./difference";
import {
  publicationVersion,
  PublicationRepository,
} from "./publication.repository";

/** What one answer carries. Every one of these is under the bound
 *  `@sloppy/types` holds a reader to, which is what makes a page a defence
 *  rather than a ceiling a graph can hit. */
const PUBLICATIONS_PER_PAGE = 50;
const NOTES_PER_PAGE = 200;
const SECTIONS_PER_PAGE = 2000;
const VERSIONS_PER_PAGE = 100;
const NOTES_PER_COMPARISON = 100;
/** How many bytes of writing one page carries. Well under
 *  `MAX_PUBLISHED_PAGE_BYTES`, which is where a reader gives up. */
const PAGE_BUDGET = 4 * 1024 * 1024;

@Injectable()
export class PublishedService {
  constructor(private readonly publications: PublicationRepository) {}

  /**
   * One page of what an identity publishes here. This is the exposure
   * publishing creates: anyone holding the author's identity can see that a
   * branch is published and read all of it.
   */
  async index(
    did: DidSyr,
    cursor: string | undefined,
  ): Promise<PublishedIndex> {
    const mark = pageMark(cursor, did);
    const run = await this.publications.page(
      did,
      mark?.at,
      PUBLICATIONS_PER_PAGE + 1,
    );
    const listed = run.slice(0, PUBLICATIONS_PER_PAGE);
    const latest = await this.publications.latestOf(
      did,
      listed.map((row) => ownedRefFrom(row.id)),
    );
    const titles = await this.publications.rootTitles(
      did,
      listed.flatMap((row) => {
        const version = latest.get(ownedRefFrom(row.id));
        return version === undefined
          ? []
          : [{ version: ownedRefFrom(version.id), address: row.root_address }];
      }),
    );
    return {
      did,
      publications: listed.flatMap((row) =>
        published(row, latest.get(ownedRefFrom(row.id)), titles),
      ),
      ...(run.length > PUBLICATIONS_PER_PAGE
        ? {
            next_cursor: markPage({
              of: did,
              at: listed[listed.length - 1].root_address,
            }),
          }
        : {}),
    };
  }

  /** `null` where nothing is published there, which is also what a publication
   *  that has been taken down leaves behind. */
  async subtree(
    did: DidSyr,
    publication: OwnedRef,
    asked: OwnedRef | undefined,
    cursor: string | undefined,
  ): Promise<PublishedSubtreePage | null> {
    const read = await this.reading(did, publication, asked);
    if (read === null) return null;
    const { chain, version } = read;
    const of = `${publication}|${ownedRefFrom(version.id)}`;
    const page = await this.run(
      did,
      ownedRefFrom(version.id),
      of,
      pageMark(cursor, of),
    );
    return {
      publication,
      version: publicationVersion(version),
      root_address: chain.root_address,
      comments: chain.comments,
      nodes: page.nodes,
      blocks: page.blocks,
      ...(page.next === undefined ? {} : { next_cursor: markPage(page.next) }),
    };
  }

  async versions(
    did: DidSyr,
    publication: OwnedRef,
    cursor: string | undefined,
  ): Promise<PublishedVersionsPage | null> {
    const chain = await this.publications.find(did, publication);
    if (!chain) return null;
    const mark = pageMark(cursor, publication);
    const run = await this.publications.versionsPage(
      did,
      publication,
      mark?.seq,
      VERSIONS_PER_PAGE + 1,
    );
    const listed = run.slice(0, VERSIONS_PER_PAGE);
    return {
      publication,
      versions: listed.map(publicationVersion),
      ...(run.length > VERSIONS_PER_PAGE
        ? {
            next_cursor: markPage({
              of: publication,
              seq: listed[listed.length - 1].sequence,
            }),
          }
        : {}),
    };
  }

  /**
   * What the writing did between two versions, in the address order a version's
   * own pages take. Both sides are read here, so a reader holding neither pays
   * for neither.
   */
  async changes(
    did: DidSyr,
    publication: OwnedRef,
    from: OwnedRef,
    to: OwnedRef,
    cursor: string | undefined,
  ): Promise<PublishedChangesPage | null> {
    const chain = await this.publications.find(did, publication);
    if (!chain) return null;
    const earlier = await this.versionIn(did, publication, from);
    const later = await this.versionIn(did, publication, to);
    if (earlier === null || later === null) return null;

    const of = `${publication}|${from}|${to}`;
    const mark = pageMark(cursor, of);
    const before = await this.side(did, from, mark?.at);
    const after = await this.side(did, to, mark?.at);
    const compared = await this.comparison(
      did,
      { version: from, run: before.run },
      { version: to, run: after.run },
      comparableTo(before, after),
    );
    const taken = held(noteChanges(compared.from, compared.to));
    const resume = taken.at ?? compared.boundary;

    return {
      publication,
      root_address: chain.root_address,
      from,
      to,
      changes: taken.changes,
      ...(resume === undefined
        ? {}
        : { next_cursor: markPage({ of, at: resume }) }),
    };
  }

  private async reading(
    did: DidSyr,
    publication: OwnedRef,
    asked: OwnedRef | undefined,
  ): Promise<{ chain: Publication; version: PublicationVersion } | null> {
    const chain = await this.publications.find(did, publication);
    if (!chain) return null;
    if (asked !== undefined) {
      const version = await this.versionIn(did, publication, asked);
      return version === null ? null : { chain, version };
    }
    const latest = await this.publications.latestOf(did, [publication]);
    const version = latest.get(publication);
    return version === undefined ? null : { chain, version };
  }

  private async versionIn(
    did: DidSyr,
    publication: OwnedRef,
    ref: OwnedRef,
  ): Promise<PublicationVersion | null> {
    const version = await this.publications.findVersion(did, ref);
    return version && version.publication === publication ? version : null;
  }

  /**
   * One page of a version: notes in address order, each with the stack that
   * version froze, until a bound. A note whose stack alone runs past one page
   * carries what fits and the cursor resumes inside it — every reference still
   * resolves in the page carrying it or in one already sent.
   */
  private async run(
    did: DidSyr,
    version: OwnedRef,
    of: string,
    mark: PageMark | undefined,
  ): Promise<{
    nodes: PublishedNode[];
    blocks: PublishedBlock[];
    next?: PageMark;
  }> {
    if (mark?.at !== undefined && mark.ord !== undefined) {
      const held = await this.publications.nodeAt(did, version, mark.at);
      if (held !== null) {
        return this.oneNote(did, version, of, held, mark.ord, false);
      }
    }

    const window = await this.publications.nodesFrom(
      did,
      version,
      mark?.at,
      NOTES_PER_PAGE + 1,
    );
    const listed = window.slice(0, NOTES_PER_PAGE);
    if (listed.length === 0) return { nodes: [], blocks: [] };

    const held = await this.whole(did, version, listed);
    if (held === null) {
      return this.oneNote(did, version, of, listed[0], "", true);
    }
    const { run, stacks } = held;

    const nodes: PublishedNode[] = [];
    const blocks: PublishedBlock[] = [];
    let spent = 0;
    let next: PageMark | undefined;
    for (const row of run) {
      nodes.push(publishedNode(row));
      spent += weigh(row.node);
      const stack = stacks.get(row.source) ?? [];
      for (const [at, section] of stack.entries()) {
        blocks.push(publishedBlock(section));
        spent += weigh(section.content);
        if (spent >= PAGE_BUDGET && at < stack.length - 1) {
          next = { of, at: row.address, ord: section.ord };
          break;
        }
      }
      if (next !== undefined) break;
      if (spent >= PAGE_BUDGET) {
        next = { of, at: row.address };
        break;
      }
    }
    if (next === undefined && window.length > run.length) {
      next = { of, at: run[run.length - 1].address };
    }
    return { nodes, blocks, ...(next === undefined ? {} : { next }) };
  }

  /**
   * As long a run of the window as one read of the sections covers, and those
   * sections. A short read says nothing about which notes are whole, so the run
   * narrows until the read is not short — a version whose notes carry many
   * sections each serves fewer notes per page rather than one.
   *
   * `null` where a single note's stack runs past a read: there is nothing
   * narrower to ask for, and {@link oneNote} pages inside it.
   */
  private async whole(
    did: DidSyr,
    version: OwnedRef,
    window: readonly SnapshotNode[],
  ): Promise<{
    run: SnapshotNode[];
    stacks: Map<OwnedRef, SnapshotBlock[]>;
  } | null> {
    for (
      let width = window.length;
      ;
      width = Math.max(1, Math.floor(width / 4))
    ) {
      const run = window.slice(0, width);
      const sections = await this.publications.blocksOf(
        did,
        version,
        run.map((row) => row.source),
        SECTIONS_PER_PAGE + 1,
      );
      if (sections.length <= SECTIONS_PER_PAGE) {
        const stacks = new Map<OwnedRef, SnapshotBlock[]>();
        for (const section of sections) {
          const stack = stacks.get(section.node);
          if (stack) stack.push(section);
          else stacks.set(section.node, [section]);
        }
        return { run, stacks };
      }
      if (width === 1) return null;
    }
  }

  /** One note's stack, read in its own order — for a note whose sections do not
   *  fit beside anybody else's. */
  private async oneNote(
    did: DidSyr,
    version: OwnedRef,
    of: string,
    held: SnapshotNode,
    after: string,
    sending: boolean,
  ): Promise<{
    nodes: PublishedNode[];
    blocks: PublishedBlock[];
    next?: PageMark;
  }> {
    const run = await this.publications.blocksAfter(
      did,
      version,
      held.source,
      after,
      SECTIONS_PER_PAGE + 1,
    );
    const listed = run.slice(0, SECTIONS_PER_PAGE);
    const nodes = sending ? [publishedNode(held)] : [];
    const blocks: PublishedBlock[] = [];
    let spent = sending ? weigh(held.node) : 0;
    for (const section of listed) {
      blocks.push(publishedBlock(section));
      spent += weigh(section.content);
      if (spent >= PAGE_BUDGET) break;
    }
    const finished =
      blocks.length === listed.length && run.length <= SECTIONS_PER_PAGE;
    return {
      nodes,
      blocks,
      next: finished
        ? { of, at: held.address }
        : { of, at: held.address, ord: listed[blocks.length - 1].ord },
    };
  }

  /**
   * Both versions' notes over one run of the address order, each carrying the
   * sections a comparison needs: none for a note only the earlier version has,
   * because what it said is in the version that still has it.
   *
   * A short read of either stack would report sections as gone that are merely
   * unread, so the run narrows until both sides are whole. One note whose stack
   * alone runs past a read is where that stops: a comparison is one entry per
   * note, so there is nothing narrower to ask for.
   */
  private async comparison(
    did: DidSyr,
    earlier: { version: OwnedRef; run: readonly SnapshotNode[] },
    later: { version: OwnedRef; run: readonly SnapshotNode[] },
    reach: string | undefined,
  ): Promise<{ from: SnapshotSide[]; to: SnapshotSide[]; boundary?: string }> {
    const within = (row: SnapshotNode) =>
      reach === undefined || row.address <= reach;
    const fromRun = earlier.run.filter(within);
    const toRun = later.run.filter(within);
    const addresses = [
      ...new Set([...fromRun, ...toRun].map((row) => row.address)),
    ].sort();

    if (addresses.length === 0) {
      return {
        from: [],
        to: [],
        ...(reach === undefined ? {} : { boundary: reach }),
      };
    }
    for (
      let width = addresses.length;
      ;
      width = Math.max(1, Math.floor(width / 4))
    ) {
      const limit = addresses[width - 1];
      const from = fromRun.filter((row) => row.address <= limit);
      const to = toRun.filter((row) => row.address <= limit);
      const shared = new Set(to.map((row) => row.address));
      const before = await this.stacks(
        did,
        earlier.version,
        from.filter((row) => shared.has(row.address)),
      );
      const after = await this.stacks(did, later.version, to);
      if (!(before.whole && after.whole) && width > 1) continue;
      const boundary = width < addresses.length ? limit : reach;
      return {
        from: from.map((row) => sideOf(row, before.stacks)),
        to: to.map((row) => sideOf(row, after.stacks)),
        ...(boundary === undefined ? {} : { boundary }),
      };
    }
  }

  private async stacks(
    did: DidSyr,
    version: OwnedRef,
    notes: readonly SnapshotNode[],
  ): Promise<{ stacks: Map<OwnedRef, PublishedBlock[]>; whole: boolean }> {
    const stacks = new Map<OwnedRef, PublishedBlock[]>();
    const sections = await this.publications.blocksOf(
      did,
      version,
      notes.map((row) => row.source),
      SECTIONS_PER_PAGE + 1,
    );
    for (const section of sections.slice(0, SECTIONS_PER_PAGE)) {
      const stack = stacks.get(section.node);
      if (stack) stack.push(publishedBlock(section));
      else stacks.set(section.node, [publishedBlock(section)]);
    }
    return { stacks, whole: sections.length <= SECTIONS_PER_PAGE };
  }

  private async side(
    did: DidSyr,
    version: OwnedRef,
    after: Address | undefined,
  ): Promise<{ run: SnapshotNode[]; last?: string; more: boolean }> {
    const window = await this.publications.nodesFrom(
      did,
      version,
      after,
      NOTES_PER_COMPARISON + 1,
    );
    const run = window.slice(0, NOTES_PER_COMPARISON);
    return {
      run,
      ...(run.length === 0 ? {} : { last: run[run.length - 1].address }),
      more: window.length > NOTES_PER_COMPARISON,
    };
  }
}

/**
 * As much of a comparison as one page carries, cut at an address: an address
 * whose note is gone in one version and different in the other is two entries,
 * and a page that carried one of them would lose the other.
 */
function held(changes: readonly PublishedNoteChange[]): {
  changes: PublishedNoteChange[];
  at?: string;
} {
  const taken: PublishedNoteChange[] = [];
  let spent = 0;
  for (let at = 0; at < changes.length; ) {
    const address = changes[at].note.address;
    let next = at;
    let weight = 0;
    while (next < changes.length && changes[next].note.address === address) {
      weight += weigh(changes[next]);
      next += 1;
    }
    const past =
      spent + weight > PAGE_BUDGET ||
      taken.length + (next - at) > MAX_PUBLISHED_CHANGES_PER_PAGE;
    if (taken.length > 0 && past) {
      return { changes: taken, at: changes[at - 1].note.address };
    }
    taken.push(...changes.slice(at, next));
    spent += weight;
    at = next;
  }
  return { changes: taken };
}

function published(
  row: Publication,
  version: PublicationVersion | undefined,
  titles: ReadonlyMap<OwnedRef, string>,
): PublishedPublication[] {
  if (version === undefined) return [];
  const ref = ownedRefFrom(version.id);
  return [
    {
      ref: ownedRefFrom(row.id),
      root_address: row.root_address,
      title: titles.get(ref) ?? "",
      latest: publicationVersion(version),
    },
  ];
}

function sideOf(
  row: SnapshotNode,
  stacks: ReadonlyMap<OwnedRef, PublishedBlock[]>,
): SnapshotSide {
  return { note: publishedNode(row), sections: stacks.get(row.source) ?? [] };
}

function publishedNode(row: SnapshotNode): PublishedNode {
  return { ref: row.source, ...row.node };
}

function publishedBlock(row: SnapshotBlock): PublishedBlock {
  return {
    ref: row.source,
    node: row.node,
    ord: row.ord,
    content: row.content,
  };
}

function weigh(value: unknown): number {
  return JSON.stringify(value)?.length ?? 0;
}
