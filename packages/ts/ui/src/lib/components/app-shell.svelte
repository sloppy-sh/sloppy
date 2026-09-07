<script lang="ts">
	// The chrome around the canvas — DESIGN.md § Layout. Presentational: it is
	// handed its destinations rather than reading routes, so both shells and any
	// harness mount the same component.
	import type { Snippet } from 'svelte';
	import NavPill, { type NavAction, type NavItem } from './nav-pill.svelte';
	import { overlay } from './overlay.svelte.js';

	let {
		children,
		items = [],
		activeId,
		action,
		showNav = true,
		keyboardOpen = false
	}: {
		children: Snippet;
		items?: NavItem[];
		activeId?: string;
		action?: NavAction;
		/** False on the surfaces that are not yet inside the app — sign-in. */
		showNav?: boolean;
		/** From the `keyboard` store in @sloppy/app-core. */
		keyboardOpen?: boolean;
	} = $props();

	const showPill = $derived(showNav && items.length > 0);
</script>

<!-- The page renders HERE and only here. Chrome that varies by width flips by
     class; a per-chrome branch around this would destroy and remount the page
     on every crossing, losing the viewport and re-fetching the region. -->
<!-- `contents`: the canvas inside is positioned against the page, so the
     landmark must lay nothing out. -->
<main class="contents">{@render children()}</main>

{#if showPill}
	<NavPill {items} {activeId} {action} suppressed={overlay.open} {keyboardOpen} />
{/if}
