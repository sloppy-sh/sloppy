// The barrel for @sloppy/ui. The design system itself is app.css, imported by
// the apps as `@sloppy/ui/styles`; the shadcn-svelte primitives are reached one
// per entry point (`@sloppy/ui/button`), and what is re-exported here is the
// vocabulary Sloppy adds on top of them.

export { cn } from './utils.js';
export { scrollFade } from './scroll-fade.svelte.js';
export type {
	WithElementRef,
	WithoutChild,
	WithoutChildren,
	WithoutChildrenOrChild
} from './utils.js';

export { overlay } from './components/overlay.svelte.js';
export { default as ResponsiveModal } from './components/responsive-modal.svelte';
export { default as ReadingPanel } from './components/reading-panel.svelte';
export { default as NoteMenu, type NoteMenuItem } from './components/note-menu.svelte';
export { default as ConfirmModal } from './components/confirm/confirm-modal.svelte';
export { default as AppShell } from './components/app-shell.svelte';
export { default as NavPill, type NavAction, type NavItem } from './components/nav-pill.svelte';

export { default as PersonAvatar } from './components/identity/avatar.svelte';
export { default as PersonChip } from './components/identity/person-chip.svelte';
export { default as PersonHeader } from './components/identity/person-header.svelte';
export { default as PersonEditor } from './components/identity/person-editor.svelte';
export { initialsOf, nameOf } from './components/identity/person.js';
export type { Person, PictureRole } from './components/identity/person.js';

export { default as GraphSurface } from './components/graph/graph-surface.svelte';
export * from './components/graph/view.js';
export { default as TagField } from './components/tags/tag-field.svelte';
export { default as TagRail } from './components/tags/tag-rail.svelte';
export { default as BlockStack } from './components/editor/block-stack.svelte';
export type {
	BlockStackProps,
	HeldPicture,
	NoteEmoji,
	NoteMedia,
	NoteReferences,
	SendingPicture,
	ShownPicture
} from './components/editor/contract.js';
export type { CustomEmojiEntry } from './emoji/catalog.js';
export * from './components/templates/index.js';
export * from './components/appearance/index.js';
export * from './components/graph/chosen.js';
