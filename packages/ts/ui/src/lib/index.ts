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
export { default as AppShell } from './components/app-shell.svelte';
export { default as NavPill, type NavAction, type NavItem } from './components/nav-pill.svelte';

export { default as GraphSurface } from './components/graph/graph-surface.svelte';
export { default as BlockStack } from './components/editor/block-stack.svelte';
export type { BlockStackProps } from './components/editor/contract.js';
