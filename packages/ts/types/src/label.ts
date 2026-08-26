// The facet axis: typed dimensions rather than free tags, so sets intersect
// across the genealogical tree instead of alongside it.

import { z } from "zod";
import { OwnedEntitySchema } from "./common.js";

/** `--facet-1 … --facet-8`, the hue slots DESIGN.md § Hue allocates. */
export const FACET_SLOT_COUNT = 8;

export const FacetSlotSchema = z.int().min(1).max(FACET_SLOT_COUNT);
export type FacetSlot = z.infer<typeof FacetSlotSchema>;

/** A node's labels: one value per dimension, `{ domain: "biology" }`. */
export const LabelSetSchema = z.record(
  z.string().min(1).max(64),
  z.string().min(1).max(64),
);
export type LabelSet = z.infer<typeof LabelSetSchema>;

export const LabelDimensionSchema = OwnedEntitySchema.extend({
  /** The key a node's `labels` uses: `domain`, `status`, `type`. */
  name: z.string().min(1).max(64),
  values: z.array(z.string().min(1).max(64)).default([]),
  /**
   * Which hue slot this dimension paints in when it is the active lens. Absent
   * means declaration order picks the slot; DESIGN.md § Hue states both rules.
   */
  color_slot: FacetSlotSchema.optional(),
});
export type LabelDimension = z.infer<typeof LabelDimensionSchema>;

export const CreateLabelDimensionRequestSchema = LabelDimensionSchema.omit({
  id: true,
  created_by: true,
  created_at: true,
  updated_at: true,
});
export type CreateLabelDimensionRequest = z.infer<
  typeof CreateLabelDimensionRequestSchema
>;

/**
 * Renaming a dimension rewrites the key on every node carrying it, so the API
 * owns that sweep; the shape only says the rename is allowed.
 */
export const UpdateLabelDimensionRequestSchema =
  CreateLabelDimensionRequestSchema.partial();
export type UpdateLabelDimensionRequest = z.infer<
  typeof UpdateLabelDimensionRequestSchema
>;
