// The barrel for @sloppy/ui. The design system itself is app.css, imported by
// the apps as `@sloppy/ui/styles`; the shadcn-svelte primitives are reached one
// per entry point (`@sloppy/ui/button`), and what is re-exported here is the
// vocabulary Sloppy adds on top of them.

export { cn } from './utils.js';
export type {
	WithElementRef,
	WithoutChild,
	WithoutChildren,
	WithoutChildrenOrChild
} from './utils.js';

export { overlay } from './components/overlay.svelte.js';
export { default as ResponsiveModal } from './components/responsive-modal.svelte';
export { default as ConfirmModal } from './components/confirm/confirm-modal.svelte';
export { default as AppShell } from './components/app-shell.svelte';
export { default as NavPill, type NavAction, type NavItem } from './components/nav-pill.svelte';

export { default as GraphSurface } from './components/graph/graph-surface.svelte';
export { default as BlockStack } from './components/editor/block-stack.svelte';
export type { BlockStackProps } from './components/editor/contract.js';

export { default as DimensionEditor } from './components/facets/dimension-editor.svelte';
export { default as FacetLegend } from './components/facets/facet-legend.svelte';
export { default as FacetValues } from './components/facets/facet-values.svelte';
export { default as LabelPicker } from './components/facets/label-picker.svelte';
export { valueChanges } from './components/facets/contract.js';
export type {
	DimensionDraft,
	EditedValue,
	LabelPickerProps,
	SlotLookup,
	ValueChanges
} from './components/facets/contract.js';
