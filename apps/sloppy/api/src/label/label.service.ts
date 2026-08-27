// The facet axis: dimensions with a declared value set, and the rules that keep
// a node's labels answerable against them.

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  type CreateLabelDimensionRequestSchema,
  createOwnedRecordId,
  entityView,
  type LabelDimension,
  type LabelDimensionView,
  type LabelSet,
  nowIso,
  type OwnedRef,
  type UpdateLabelDimensionRequestSchema,
} from "@sloppy/types";
import type { z } from "zod";
import { NodeRepository } from "../node/node.repository";
import { LabelRepository } from "./label.repository";

type CreateRequest = z.output<typeof CreateLabelDimensionRequestSchema>;
type UpdateRequest = z.output<typeof UpdateLabelDimensionRequestSchema>;

@Injectable()
export class LabelService {
  constructor(
    private readonly dimensions: LabelRepository,
    private readonly nodes: NodeRepository,
  ) {}

  async list(did: string): Promise<LabelDimensionView[]> {
    return (await this.dimensions.list(did)).map(entityView);
  }

  async create(
    did: string,
    request: CreateRequest,
  ): Promise<LabelDimensionView> {
    await this.refuseNameClash(did, request.name);
    const now = nowIso();
    return entityView(
      await this.dimensions.insert({
        id: createOwnedRecordId("label_dimension", did),
        created_by: did,
        name: request.name,
        values: request.values,
        ...(request.color_slot === undefined
          ? {}
          : { color_slot: request.color_slot }),
        created_at: now,
        updated_at: now,
      }),
    );
  }

  /**
   * A rename carries the key on every node that holds it, so no note is left
   * labelled with a dimension nobody has. Dropping a value that notes still
   * carry is refused instead: the labels are the author's, not ours to discard.
   */
  async update(
    did: string,
    ref: OwnedRef,
    request: UpdateRequest,
  ): Promise<LabelDimensionView> {
    const before = await this.dimensions.find(did, ref);
    if (!before) throw new NotFoundException("That dimension is not here.");

    if (request.name !== undefined && request.name !== before.name) {
      await this.refuseNameClash(did, request.name);
    }
    if (request.values !== undefined) {
      await this.refuseOrphanedValues(did, before, request.values);
    }

    const after = await this.dimensions.patch(did, ref, request);
    if (!after) throw new NotFoundException("That dimension is not here.");
    if (after.name !== before.name) {
      await this.renameOnNodes(did, before.name, after.name);
    }
    return entityView(after);
  }

  /** The dimension goes, and the label it keyed goes with it. */
  async remove(did: string, ref: OwnedRef): Promise<void> {
    const dimension = await this.dimensions.find(did, ref);
    if (!dimension) return;
    await this.dimensions.remove(did, ref);
    await this.rewrite(did, dimension.name, () => undefined);
  }

  /**
   * Every label on a node names a dimension the author declared and a value
   * that dimension allows. One value per dimension needs no check of its own:
   * `labels` is keyed BY the dimension, so a second value replaces the first.
   */
  async assertUsable(did: string, labels: LabelSet): Promise<void> {
    const entries = Object.entries(labels);
    if (entries.length === 0) return;
    const declared = new Map(
      (await this.dimensions.list(did)).map((d) => [d.name, d.values]),
    );
    for (const [name, value] of entries) {
      const values = declared.get(name);
      if (!values) {
        throw new BadRequestException(
          `There is no "${name}" dimension. Add it before labelling with it.`,
        );
      }
      if (!values.includes(value)) {
        throw new BadRequestException(
          `"${value}" is not one of the values in "${name}".`,
        );
      }
    }
  }

  private async refuseNameClash(did: string, name: string): Promise<void> {
    const taken = (await this.dimensions.list(did)).some(
      (dimension) => dimension.name === name,
    );
    if (taken) {
      throw new ConflictException(`You already have a "${name}" dimension.`);
    }
  }

  private async refuseOrphanedValues(
    did: string,
    before: LabelDimension,
    values: readonly string[],
  ): Promise<void> {
    const dropped = before.values.filter((value) => !values.includes(value));
    const inUse = await this.nodes.countCarryingValues(
      did,
      before.name,
      dropped,
    );
    if (inUse > 0) {
      throw new ConflictException(
        `${inUse} ${inUse === 1 ? "note is" : "notes are"} still labelled with a value you are removing. Relabel them first.`,
      );
    }
  }

  private renameOnNodes(did: string, from: string, to: string): Promise<void> {
    return this.rewrite(did, from, (value) => ({ [to]: value }));
  }

  private async rewrite(
    did: string,
    name: string,
    replacement: (value: string) => LabelSet | undefined,
  ): Promise<void> {
    const carriers = await this.nodes.carryingDimension(did, name);
    await this.nodes.replaceLabels(
      carriers.map((node) => {
        const { [name]: value, ...rest } = node.labels;
        return { id: node.id, labels: { ...rest, ...replacement(value) } };
      }),
    );
  }
}
