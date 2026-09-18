// Changes offered on a note, and what settling one does to the note —
// docs/ARCHITECTURE.md § "Whose writing a note carries".

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  type Amendment,
  type AmendmentView,
  createOwnedRecordId,
  type DidSyr,
  entityView,
  looksRead,
  looksWritten,
  type NodeView,
  type OwnedRef,
  ownedRefFrom,
  splitOwnedRef,
} from "@sloppy/types";
import { orderKeyBetween } from "../block/fractional-index";
import { BlockRepository } from "../block/block.repository";
import { referencesOf } from "../block/references";
import { NodeRepository } from "../node/node.repository";
import type { SettledSection } from "./amendment.repository";
import { AmendmentRepository } from "./amendment.repository";

@Injectable()
export class AmendmentService {
  constructor(
    private readonly amendments: AmendmentRepository,
    private readonly nodes: NodeRepository,
    private readonly blocks: BlockRepository,
  ) {}

  /** What has been offered on one of the caller's notes, oldest first. */
  async list(did: DidSyr, note: OwnedRef): Promise<AmendmentView[]> {
    if (!(await this.nodes.find(did, note))) {
      throw new NotFoundException("That note is not here.");
    }
    return (await this.amendments.listFor(did, note)).map(entityView);
  }

  /**
   * Refused, and that is the whole of it: a graph here has one writer, so a
   * change to a note is written rather than offered. What this settles is what
   * arrived with an archive of a graph somebody kept on their own device.
   */
  offer(): never {
    throw new BadRequestException(
      "A note kept here has one writer, so changes to it are written rather than offered.",
    );
  }

  /** Take back one you offered, wherever it stands. */
  async withdraw(did: DidSyr, ref: OwnedRef): Promise<void> {
    const offer = await this.amendments.find(ref);
    if (!offer || offer.by !== did) return;
    await this.amendments.remove(ref);
  }

  /** Turn one down. Nothing of it is kept. */
  async decline(did: DidSyr, ref: OwnedRef): Promise<void> {
    await this.settling(did, ref);
    await this.amendments.remove(ref);
  }

  /**
   * Take one in: the note's writing becomes the offer's, whole, and the person
   * who offered it joins the note's contributors. Its authorship is untouched.
   */
  async approve(did: DidSyr, ref: OwnedRef): Promise<NodeView> {
    const offer = await this.settling(did, ref);
    const note = await this.nodes.find(did, offer.note);
    if (!note) throw new NotFoundException("That note is not here.");

    const standing = await this.blocks.listByNode(offer.note);
    const on = new Set(standing.map((block) => ownedRefFrom(block.id)));
    // A section naming a row that is not this note's is a section this offer
    // adds: an offer carries the note's own writing, and writing one row onto
    // it would take that row off the note it is on.
    const rows = await this.blocks.existingAmong(
      did,
      offer.blocks.map((section) => section.ref),
    );
    const sections: SettledSection[] = [];
    let ord: string | null = null;
    for (const section of offer.blocks) {
      ord = orderKeyBetween(ord, null);
      const own = on.has(section.ref);
      sections.push({
        ref:
          own || !rows.has(section.ref)
            ? section.ref
            : ownedRefFrom(createOwnedRecordId("block", did)),
        content: section.content,
        ord,
        standing: own,
      });
    }
    const carried = new Set(sections.map((section) => section.ref));
    // An offer arrives in an archive, so its looks are read the way a file's
    // are: the first of two on one line, and nothing where none of them says
    // anything — an offer leaves the note's looks alone rather than taking
    // them off.
    const lines = offer.edges
      ? looksWritten(looksRead(offer.edges))
      : undefined;

    await this.amendments.approve(did, {
      offer: ref,
      note: offer.note,
      title: offer.title,
      tags: offer.tags,
      ...(offer.appearance === undefined
        ? {}
        : { appearance: offer.appearance }),
      ...(lines === undefined ? {} : { edges: lines }),
      contributors: withContributor(note.contributors, offer.by),
      references: referencesOf(offer.note, sections),
      sections,
      dropping: [...on].filter((block) => !carried.has(block)),
    });

    const written = await this.nodes.find(did, offer.note);
    if (!written) throw new NotFoundException("That note is not here.");
    return entityView(written);
  }

  /** The offer this person settles, which is one standing in their own graph. */
  private async settling(did: DidSyr, ref: OwnedRef): Promise<Amendment> {
    if (splitOwnedRef(ref).did !== did) throw notHere();
    const offer = await this.amendments.find(ref);
    if (!offer || offer.created_by !== did) throw notHere();
    return offer;
  }
}

/** The proposer joins the note's contributors, in the order they were taken
 *  in, and joins it once. */
function withContributor(
  held: readonly DidSyr[] | undefined,
  by: DidSyr,
): DidSyr[] {
  const contributors = [...(held ?? [])];
  return contributors.includes(by) ? contributors : [...contributors, by];
}

function notHere(): NotFoundException {
  return new NotFoundException("That offered change is not here.");
}
