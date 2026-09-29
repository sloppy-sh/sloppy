<script lang="ts">
	// The chrome around the canvas — DESIGN.md § Layout. Presentational: it is
	// handed its destinations rather than reading routes, so both shells and any
	// harness mount the same component. Two arrangements of the same parts: the
	// pill over the canvas, and the sidebar beside it from the dock width up.
	import type { Snippet } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import DeskNav from './desk-nav.svelte';
	import { deskNav, DESK_FROM_PX } from './desk-nav.svelte.js';
	import NavPill, { type NavAction, type NavItem } from './nav-pill.svelte';
	import { overlay } from './overlay.svelte.js';

	let {
		children,
		items = [],
		activeId,
		action,
		showNav = true,
		keyboardOpen = false,
		deskNavOpen = true,
		onDeskNavOpenChange
	}: {
		children: Snippet;
		items?: NavItem[];
		activeId?: string;
		action?: NavAction;
		/** False on the surfaces that are not yet inside the app — sign-in. */
		showNav?: boolean;
		/** From the `keyboard` store in @sloppy/app-core. */
		keyboardOpen?: boolean;
		/** Whether the desk sidebar stands open or as an icon rail. */
		deskNavOpen?: boolean;
		onDeskNavOpenChange?: (open: boolean) => void;
	} = $props();

	const desk = new MediaQuery(`(min-width: ${DESK_FROM_PX}px)`);

	const showPill = $derived(showNav && items.length > 0 && !desk.current);
	const showSidebar = $derived(
		showNav && desk.current && (items.length > 0 || deskNav.parts !== null)
	);
</script>

<!-- The page renders HERE and only here. Chrome that varies by width flips by
     class; a per-chrome branch around this would destroy and remount the page
     on every crossing, losing the viewport and re-fetching the region. -->
<!-- `contents`: the canvas inside is positioned against the page, so the
     landmark must lay nothing out — except where the sidebar stands beside it
     and the page is given what is left. -->
<main
	class={showSidebar
		? deskNavOpen
			? 'block ps-(--desk-nav-width)'
			: 'block ps-(--desk-nav-rail)'
		: 'contents'}
>
	{@render children()}
</main>

{#if showSidebar}
	<DeskNav
		{items}
		{activeId}
		{action}
		open={deskNavOpen}
		onOpenChange={(open) => onDeskNavOpenChange?.(open)}
	/>
{/if}

{#if showPill}
	<NavPill {items} {activeId} {action} suppressed={overlay.open} {keyboardOpen} />
{/if}
