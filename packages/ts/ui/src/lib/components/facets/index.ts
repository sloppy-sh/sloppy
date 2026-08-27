// The facet axis's surfaces. docs/ARCHITECTURE.md § "Putting a note in a facet"
// is the doc of record for `LabelPicker`'s prop surface.

export { default as DimensionEditor } from './dimension-editor.svelte';
export { default as FacetLegend } from './facet-legend.svelte';
export { default as FacetValues } from './facet-values.svelte';
export { default as LabelPicker } from './label-picker.svelte';
export { valueChanges } from './contract.js';
export type {
	DimensionDraft,
	EditedValue,
	LabelPickerProps,
	SlotLookup,
	ValueChanges,
	ValueMerge
} from './contract.js';
