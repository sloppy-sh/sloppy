<script lang="ts">
	// What a page puts in the desk sidebar — DESIGN.md § Layout. It draws
	// nothing here; `DeskNav` draws it wherever the sidebar stands.
	import { deskNav, type DeskParts } from './desk-nav.svelte.js';

	let { children }: { children: DeskParts } = $props();

	$effect(() => deskNav.fills(children));
</script>
